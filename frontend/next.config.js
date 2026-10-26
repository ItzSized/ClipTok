/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dossier de build séparé pour le serveur rapide (scripts/serve-frontend.js) : il ne gêne pas `next dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Ce build-là ne revérifie pas les types ni le lint (faits à part avec tsc) : bien plus rapide.
  typescript: { ignoreBuildErrors: process.env.NEXT_FAST_BUILD === '1' },
  eslint: { ignoreDuringBuilds: true },
  // Le traçage des fichiers (utile seulement pour un déploiement « standalone ») parcourait
  // tout le dossier parent à cause d'externalDir — vidéos et backend/node_modules compris :
  // plus de 6 minutes par build.
  outputFileTracing: false,
  // Autorise l'import du code partagé avec le backend (../shared : moteur de sous-titres, cœur de l'éditeur).
  experimental: { externalDir: true },
  // Mode dev : garder les pages compilées en mémoire (par défaut, Next n'en garde que 5
  // pendant 60 s et recompile les autres à chaque visite).
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 30,
  },
  webpack(config, { dev }) {
    // Build du serveur rapide : sérialiser le cache webpack prenait plus de 6 minutes sur ce disque.
    if (!dev && process.env.NEXT_FAST_BUILD === '1') config.cache = false;
    // Ne surveiller que le code : pas le backend (médias, rendus, temp…) ni les builds.
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ['**/node_modules/**', '**/.git/**', '**/.next*/**', '**/backend/**', '**/scripts/**'],
      };
    }
    return config;
  },
};

module.exports = nextConfig;
