import { Sparkles, CheckCircle2, Zap, Hash } from 'lucide-react';

const FEATURES = [
  {
    icon: Sparkles,
    color: 'fuchsia',
    title: 'Curation IA',
    description:
      "Notre IA analyse le texte et l'audio pour extraire les passages avec le plus haut potentiel de viralité et de rétention, avec un score par clip.",
  },
  {
    icon: CheckCircle2,
    color: 'pink',
    title: 'Recadrage Visage',
    description:
      "La caméra virtuelle piste le visage de l'intervenant pour un cadrage 9:16 toujours parfait et dynamique, image par image.",
  },
  {
    icon: Zap,
    color: 'orange',
    title: 'Sous-titres Magiques',
    description:
      'Des sous-titres animés, karaoké mot-par-mot, générés à la volée pour capter l\'attention sans le son.',
  },
  {
    icon: Hash,
    color: 'violet',
    title: 'Légendes & Hashtags',
    description:
      "Chaque clip arrive avec une légende prête à poster et des hashtags pertinents générés par l'IA — copiez-collez, publiez.",
  },
];

const COLOR_MAP: Record<string, string> = {
  fuchsia: 'bg-fuchsia-500/20 text-fuchsia-400',
  pink: 'bg-pink-500/20 text-pink-400',
  orange: 'bg-orange-500/20 text-orange-400',
  violet: 'bg-violet-500/20 text-violet-400',
};

export default function FeaturesGrid() {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full mt-4">
      {FEATURES.map((f) => (
        <div
          key={f.title}
          className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-sm hover:bg-white/10 hover:-translate-y-1 transition-all"
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 ${COLOR_MAP[f.color]}`}>
            <f.icon className="w-6 h-6" />
          </div>
          <h3 className="text-xl font-bold text-white mb-3">{f.title}</h3>
          <p className="text-zinc-400 text-sm leading-relaxed">{f.description}</p>
        </div>
      ))}
    </div>
  );
}
