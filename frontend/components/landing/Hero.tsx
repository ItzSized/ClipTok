'use client';

import { Play, Sparkles, ChevronRight } from 'lucide-react';

interface HeroProps {
  onGetStarted: () => void;
}

export default function Hero({ onGetStarted }: HeroProps) {
  return (
    <div className="text-center space-y-6 mb-16 animate-fade-in-up">
      <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-sm font-bold text-fuchsia-400 mb-4">
        <Sparkles className="w-4 h-4" />
        ClipTok 2.0 — Curation IA + légendes prêtes à poster
      </div>
      <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tighter text-white leading-[1.1]">
        1 vidéo longue, <br />
        <span className="bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 via-pink-400 to-orange-400 bg-[length:200%_auto] animate-gradient">
          10 Shorts Viraux.
        </span>
      </h1>
      <p className="text-zinc-400 text-lg sm:text-xl max-w-2xl mx-auto">
        L'IA générative la plus complète pour transformer vos podcasts et vidéos YouTube en
        clips courts viraux pour TikTok, Reels et Shorts — recadrage intelligent, sous-titres
        animés, et légendes + hashtags générés automatiquement. En un clic.
      </p>
      <div className="pt-8 flex flex-col sm:flex-row gap-4 justify-center items-center">
        <button
          onClick={onGetStarted}
          className="group relative overflow-hidden rounded-full px-8 py-5 font-bold text-xl bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_60px_rgba(255,255,255,0.2)]"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-300 via-pink-300 to-orange-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative flex items-center gap-2 mix-blend-difference text-white">
            Démarrer gratuitement <Play className="w-5 h-5 fill-current" />
          </span>
        </button>
        <a
          href="#how-it-works"
          className="flex items-center gap-1 px-6 py-5 font-semibold text-zinc-300 hover:text-white transition-colors"
        >
          Voir comment ça marche <ChevronRight className="w-4 h-4" />
        </a>
      </div>
    </div>
  );
}
