import { PlayCircle } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="w-full border-t border-white/5 mt-8">
      <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center">
            <PlayCircle className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-black tracking-tighter text-white">ClipTok</span>
        </div>
        <p className="text-xs text-zinc-600 text-center">
          © {new Date().getFullYear()} ClipTok. Transformez vos vidéos en clips viraux.
        </p>
      </div>
    </footer>
  );
}
