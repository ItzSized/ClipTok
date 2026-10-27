/**
 * webMedia.js
 *
 * L'Éditeur IA va chercher des visuels sur le web et les ajoute aux médias :
 *   - screenshot : capture d'écran d'un site (Puppeteer) — l'URL donnée, sinon le
 *     premier résultat de la recherche web (souvent le site officiel) ;
 *   - image : première image exploitable de Bing Images (aucune clé) ;
 *   - video : extrait d'une vidéo YouTube (yt-dlp, recherche « ytsearch »).
 * Tout est gratuit et sans clé.
 */
const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const media = require('./media');
const { webSearch, duckDuckGo } = require('./webSearch');
const { runYtDlpWithAuth } = require('./downloader');
const { FFMPEG_PATH } = require('./ffmpegUtils');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const timeout = (signal, ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
const cleanTitle = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'web';

/** Premier site trouvé pour la recherche (on évite les réseaux sociaux et vidéos). */
async function firstSite(query, signal) {
  // DuckDuckGo d'abord (instantané) ; la recherche Google via Gemini est plus lente.
  const { sources = [] } = await duckDuckGo(query, signal).catch(() => webSearch(query, signal));
  const site = sources.find((s) => /^https?:/.test(s.url) && !/youtube\.|tiktok\.|facebook\.|instagram\.|twitter\.|x\.com|reddit\./i.test(s.url)) || sources[0];
  if (!site) throw new Error(`aucun site trouvé pour « ${query} »`);
  return site.url;
}

async function screenshot({ query, url }, signal) {
  const target = url || (await firstSite(query, signal));
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
  const onAbort = () => browser.close().catch(() => { });
  signal?.addEventListener('abort', onAbort);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 8000 }).catch(() => { });
    // Bandeaux de cookies : on accepte pour qu'ils ne cachent pas la page.
    await page
      .evaluate(() => {
        const btn = [...document.querySelectorAll('button, a[role="button"]')].find((b) => /^(accept|accept all|accepter|tout accepter|agree|i agree|ok|got it|allow all)$/i.test((b.textContent || '').trim()));
        btn?.click();
      })
      .catch(() => { });
    await new Promise((r) => setTimeout(r, 1500));
    const file = path.join(media.UPLOADS_DIR, `${uuidv4()}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    const title = cleanTitle((await page.title().catch(() => '')) || new URL(target).hostname);
    return { file, name: `Capture - ${title}.jpg`, source: target };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await browser.close().catch(() => { });
  }
}

async function image({ query, url }, signal) {
  let candidates = url ? [url] : [];
  if (!url) {
    const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`, { headers: { 'User-Agent': UA }, signal: timeout(signal, 20000) });
    const html = await res.text();
    candidates = [...html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)].map((m) => m[1]).filter((u) => /^https?:/.test(u)).slice(0, 8);
  }
  for (const src of candidates) {
    try {
      const res = await fetch(src, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: timeout(signal, 20000) });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !IMAGE_EXT[type]) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8000) continue; // icônes et pixels de suivi
      const file = path.join(media.UPLOADS_DIR, `${uuidv4()}${IMAGE_EXT[type]}`);
      await fs.writeFile(file, buf);
      return { file, name: `${cleanTitle(query)}${IMAGE_EXT[type]}`, source: src };
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  throw new Error(`aucune image téléchargeable pour « ${query} »`);
}

async function video({ query, url, start = 0, duration = 20 }, signal) {
  const dir = path.join(media.TEMP_DIR, `web-${uuidv4()}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    const from = Math.max(0, Number(start) || 0);
    const to = from + Math.min(90, Math.max(3, Number(duration) || 20));
    const { stdout } = await runYtDlpWithAuth(
      [
        '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b',
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', FFMPEG_PATH,
        '--download-sections', `*${from}-${to}`,
        '--match-filter', '!is_live',
        '--no-playlist',
        '--print', 'after_move:%(title)s',
        '-o', path.join(dir, 'clip.%(ext)s'),
        url || `ytsearch1:${query}`,
      ],
      null,
      signal
    );
    const title = stdout.trim().split('\n').pop();
    const file0 = (await fs.readdir(dir)).find((f) => /^clip\.(mp4|mkv|webm)$/.test(f));
    if (!file0) throw new Error('téléchargement vide');
    const file = path.join(media.UPLOADS_DIR, `${uuidv4()}${path.extname(file0)}`);
    await fs.rename(path.join(dir, file0), file).catch(async () => {
      await fs.copyFile(path.join(dir, file0), file);
    });
    return { file, name: `${cleanTitle(title || query)}.mp4`, source: url || `YouTube : ${query}` };
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => { });
  }
}

/**
 * Va chercher un visuel sur le web et l'enregistre comme média.
 * opts : { query, kind: 'screenshot'|'image'|'video', url?, start?, duration? }
 */
async function fetchWebMedia(opts, signal) {
  const kind = ['screenshot', 'image', 'video'].includes(opts.kind) ? opts.kind : 'image';
  const query = String(opts.query || '').trim().slice(0, 200);
  const url = typeof opts.url === 'string' && /^https?:\/\//.test(opts.url) ? opts.url : '';
  if (!query && !url) throw new Error('Recherche vide.');
  await fs.mkdir(media.UPLOADS_DIR, { recursive: true });
  let got;
  try {
    got = await (kind === 'screenshot' ? screenshot : kind === 'video' ? video : image)({ ...opts, query, url }, signal);
  } catch (err) {
    if (signal?.aborted || kind !== 'image') throw err;
    // Aucune image utilisable : capture du site à la place.
    got = await screenshot({ query, url: '' }, signal);
  }
  try {
    return await media.registerFile(got.file, { name: got.name, source: 'web', extra: { webSource: got.source } });
  } catch (err) {
    await fs.unlink(got.file).catch(() => { });
    throw err;
  }
}

module.exports = { fetchWebMedia };
