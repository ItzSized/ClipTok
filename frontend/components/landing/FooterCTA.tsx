import { Sparkles } from 'lucide-react';

export default function FooterCTA({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <div className="w-full relative overflow-hidden rounded-[2.5rem] border border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/10 via-black to-orange-500/10 p-10 sm:p-16 text-center">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-fuchsia-600/20 blur-[100px] rounded-full pointer-events-none" />
      <div className="relative z-10">
        <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-4">
          Prêt à transformer votre prochaine vidéo ?
        </h2>
        <p className="text-zinc-400 text-lg mb-8 max-w-xl mx-auto">
          Aucune carte bancaire requise pour commencer.
        </p>
        <button
          onClick={onGetStarted}
          className="group relative overflow-hidden rounded-full px-8 py-5 font-bold text-lg bg-white text-black hover:scale-105 active:scale-95 transition-all shadow-[0_0_60px_rgba(255,255,255,0.2)] inline-flex items-center gap-2"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-fuchsia-300 via-pink-300 to-orange-300 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative flex items-center gap-2 mix-blend-difference text-white">
            <Sparkles className="w-5 h-5" /> Générer mes premiers clips
          </span>
        </button>
      </div>
    </div>
  );
}
