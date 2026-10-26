/**
 * Préchauffage du mode développement : dès que Next.js est prêt, on demande
 * chaque page une fois pour qu'elle soit compilée AVANT que l'utilisateur ne
 * clique dessus (en dev, Next compile chaque page à sa première visite).
 */
const BASE = process.env.WARMUP_URL || 'http://localhost:3000';
const PAGES = ['/', '/login', '/dashboard', '/editor', '/editor/warmup', '/ai-editor', '/ai-editor/warmup', '/captions', '/captions/warmup', '/settings', '/dashboard/composer', '/pricing', '/ai-usage'];

async function waitForServer(timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(BASE, { method: 'HEAD' });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

(async () => {
  if (!(await waitForServer())) return console.log('Next.js injoignable, préchauffage ignoré.');
  const t0 = Date.now();
  for (const page of PAGES) {
    try {
      await fetch(BASE + page);
    } catch {}
  }
  console.log(`${PAGES.length} pages précompilées en ${((Date.now() - t0) / 1000).toFixed(1)} s — l'application est prête : ${BASE}`);
})();
