const STATS = [
  { value: '9:16', label: 'Recadrage intelligent' },
  { value: '100%', label: 'Sous-titres automatiques' },
  { value: '3', label: 'Résolutions : 720p → 4K' },
  { value: '1 clic', label: 'De l\'URL au clip final' },
];

export default function StatsBar() {
  return (
    <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6 mb-20">
      {STATS.map((s) => (
        <div
          key={s.label}
          className="text-center bg-white/[0.03] border border-white/10 rounded-2xl py-6 px-3 hover:bg-white/[0.06] transition-colors"
        >
          <div className="text-3xl sm:text-4xl font-black text-white mb-1">{s.value}</div>
          <div className="text-xs sm:text-sm text-zinc-500 font-medium">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
