import { Check, X, Minus } from 'lucide-react';

type Cell = true | false | string;

const ROWS: { label: string; cliptok: Cell; classic: Cell }[] = [
  { label: 'Curation des moments viraux par IA', cliptok: true, classic: false },
  { label: 'Recadrage 9:16 qui suit le visage', cliptok: true, classic: false },
  { label: 'Sous-titres animés mot-par-mot', cliptok: true, classic: 'Manuel' },
  { label: 'Légende + hashtags générés automatiquement', cliptok: true, classic: false },
  { label: 'Score de viralité par clip', cliptok: true, classic: false },
  { label: 'Contrôle de la vitesse de lecture', cliptok: true, classic: 'Parfois' },
  { label: 'Export jusqu\'en 4K', cliptok: true, classic: 'Parfois' },
  { label: 'Organisation par projets', cliptok: true, classic: false },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <Check className="w-5 h-5 text-emerald-400 mx-auto" />;
  if (value === false) return <X className="w-5 h-5 text-zinc-600 mx-auto" />;
  return <span className="text-xs text-zinc-400 flex items-center justify-center gap-1"><Minus className="w-3 h-3" />{value}</span>;
}

export default function ComparisonTable() {
  return (
    <div className="w-full">
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">
          Pourquoi pas juste un éditeur classique ?
        </h2>
        <p className="text-zinc-400 max-w-xl mx-auto">
          Face aux outils de montage traditionnels, ClipTok automatise tout ce qui vous fait
          perdre du temps.
        </p>
      </div>

      <div className="w-full overflow-x-auto rounded-3xl border border-white/10">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr className="bg-white/5">
              <th className="text-left text-sm font-semibold text-zinc-400 px-6 py-4">Fonctionnalité</th>
              <th className="px-6 py-4">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-gradient-to-r from-fuchsia-500/20 to-orange-500/20 border border-fuchsia-500/30 px-3 py-1.5 rounded-full">
                  ClipTok
                </span>
              </th>
              <th className="px-6 py-4 text-sm font-semibold text-zinc-400">Outils classiques</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr key={row.label} className={i % 2 === 0 ? 'bg-white/[0.02]' : ''}>
                <td className="text-left text-sm text-zinc-300 px-6 py-4 border-t border-white/5">{row.label}</td>
                <td className="px-6 py-4 border-t border-white/5 text-center">
                  <CellValue value={row.cliptok} />
                </td>
                <td className="px-6 py-4 border-t border-white/5 text-center">
                  <CellValue value={row.classic} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
