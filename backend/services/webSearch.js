/**
 * Recherche web gratuite pour l'Éditeur IA.
 *   1. Google Search via Gemini (« grounding », inclus dans l'offre gratuite) ;
 *   2. sinon DuckDuckGo (page HTML publique, aucune clé).
 * Retourne { query, summary, sources: [{ title, url }], engine }.
 */
const { PROVIDERS } = require('./llm/providers');

function decodeHtml(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function duckDuckGo(query, signal) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
  });
  const html = await res.text();
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    let url = m[1];
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    results.push({ title: decodeHtml(m[2]), url, snippet: decodeHtml(m[3]) });
  }
  if (results.length === 0) throw new Error('aucun résultat');
  return {
    summary: results.map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}`).join('\n'),
    sources: results.map(({ title, url }) => ({ title, url })),
    engine: 'DuckDuckGo',
  };
}

async function webSearch(query, signal) {
  const q = String(query || '').slice(0, 300).trim();
  if (!q) throw new Error('Requête vide.');
  if (PROVIDERS.gemini.isConfigured()) {
    try {
      return { query: q, ...(await PROVIDERS.gemini.search(q, signal)) };
    } catch (err) {
      if (signal?.aborted) throw err;
      console.warn(`[search] Google via Gemini indisponible (${err.message.slice(0, 120)}), repli sur DuckDuckGo.`);
    }
  }
  return { query: q, ...(await duckDuckGo(q, signal)) };
}

module.exports = { webSearch };
