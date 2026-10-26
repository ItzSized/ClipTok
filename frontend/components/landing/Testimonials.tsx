const QUOTES = [
  {
    name: 'Léa M.',
    role: 'Créatrice de contenu podcast',
    initials: 'LM',
    color: 'from-fuchsia-500 to-pink-500',
    quote: "Je colle le lien de mon épisode, je repars 10 minutes plus tard avec des shorts prêts à poster, légende comprise.",
  },
  {
    name: 'Karim B.',
    role: 'Monteur freelance',
    initials: 'KB',
    color: 'from-orange-500 to-amber-500',
    quote: 'Le recadrage qui suit le visage me fait gagner un temps fou sur les interviews à plusieurs intervenants.',
  },
  {
    name: 'Sofia R.',
    role: 'Coach business',
    initials: 'SR',
    color: 'from-violet-500 to-fuchsia-500',
    quote: "Les scores de viralité m'aident à choisir quel clip pousser en premier sur TikTok.",
  },
  {
    name: 'Tom D.',
    role: 'Streamer / YouTubeur',
    initials: 'TD',
    color: 'from-pink-500 to-orange-500',
    quote: 'Les sous-titres animés donnent un rendu bien plus pro que ce que je faisais à la main.',
  },
  {
    name: 'Nina F.',
    role: 'Gestionnaire de communauté',
    initials: 'NF',
    color: 'from-amber-500 to-fuchsia-500',
    quote: "Les hashtags générés automatiquement collent vraiment au contenu du clip, pas juste génériques.",
  },
];

export default function Testimonials() {
  const loop = [...QUOTES, ...QUOTES];

  return (
    <div className="w-full">
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">Ils créent avec ClipTok</h2>
        <p className="text-zinc-400 max-w-xl mx-auto">Des créateurs qui ont troqué le montage manuel contre l'automatisation.</p>
      </div>

      <div className="relative w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <div className="flex gap-6 w-max animate-marquee hover:[animation-play-state:paused]">
          {loop.map((t, i) => (
            <div
              key={`${t.name}-${i}`}
              className="w-80 flex-shrink-0 bg-white/5 border border-white/10 rounded-3xl p-6"
            >
              <p className="text-zinc-300 text-sm leading-relaxed mb-5">"{t.quote}"</p>
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-xs font-bold text-white flex-shrink-0`}
                >
                  {t.initials}
                </div>
                <div>
                  <p className="text-sm font-bold text-white leading-tight">{t.name}</p>
                  <p className="text-xs text-zinc-500">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
