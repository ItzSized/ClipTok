import { Link2, BrainCircuit, Clapperboard, Download } from 'lucide-react';

const STEPS = [
  {
    icon: Link2,
    title: 'Collez le lien',
    description: "Collez l'URL d'une vidéo YouTube. Choisissez la qualité, le format et la durée cible.",
  },
  {
    icon: BrainCircuit,
    title: "L'IA analyse tout",
    description:
      'Transcription mot-par-mot puis analyse sémantique pour repérer les passages les plus accrocheurs.',
  },
  {
    icon: Clapperboard,
    title: 'Rendu automatique',
    description:
      'Recadrage 9:16 qui suit le visage, sous-titres animés incrustés, légende et hashtags générés.',
  },
  {
    icon: Download,
    title: 'Téléchargez & publiez',
    description: 'Récupérez vos clips en MP4 (+ MP3), copiez la légende, et publiez sur vos réseaux.',
  },
];

export default function HowItWorks() {
  return (
    <div id="how-it-works" className="w-full scroll-mt-24">
      <div className="text-center mb-14">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">Comment ça marche</h2>
        <p className="text-zinc-400 max-w-xl mx-auto">
          Quatre étapes, zéro montage manuel.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {STEPS.map((s, i) => (
          <div key={s.title} className="relative bg-white/5 border border-white/10 rounded-3xl p-6">
            <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center text-xs font-black text-white shadow-lg">
              {i + 1}
            </div>
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center mb-5 mt-2">
              <s.icon className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-base font-bold text-white mb-2">{s.title}</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">{s.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
