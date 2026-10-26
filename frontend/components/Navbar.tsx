'use client';

import { useEffect, useState } from 'react';
import { PlayCircle, LayoutDashboard, Menu, X, Volume2, VolumeX, Settings, LogOut, ChevronDown, Gauge } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isSoundEnabled, setSoundEnabled, playSuccessChime } from '@/lib/sound';
import { useAuth } from './AuthProvider';
import GpuMonitor from './GpuMonitor';

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const pathname = usePathname();
  const { user, logout } = useAuth();

  useEffect(() => {
    setSoundOn(isSoundEnabled());
  }, []);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled(next);
    if (next) playSuccessChime();
  };

  const isActive = (path: string) => {
    if (path === '/' && pathname !== '/') return false;
    if (path === '/dashboard' && pathname.startsWith('/dashboard/composer')) return false;
    if (path !== '/' && pathname.startsWith(path)) return true;
    return pathname === path;
  };

  const linkClass = (path: string) =>
    `whitespace-nowrap hover:text-white transition-colors ${isActive(path) ? 'text-white' : ''}`;

  // Liens principaux : les outils pour un utilisateur connecté, la vitrine sinon.
  const links = user
    ? [
        { href: '/dashboard', label: 'Auto Clip' },
        { href: '/captions', label: 'Sous-titres' },
        { href: '/editor', label: 'Éditeur' },
        { href: '/ai-editor', label: 'Éditeur IA' },
        { href: '/dashboard/composer', label: 'Composer' },
      ]
    : [
        { href: '/', label: 'Accueil' },
        { href: '/pricing', label: 'Tarifs' },
      ];

  const mobileLinkClass = (path: string) =>
    `text-left px-4 py-3 rounded-xl font-semibold text-sm ${isActive(path) ? 'bg-white/10 text-white' : 'text-zinc-400'}`;

  return (
    <nav className="w-full px-4 sm:px-8 py-4 border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-[1500px] mx-auto flex justify-between items-center gap-4">
        <div className="flex items-center gap-8 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => setMobileOpen(false)}
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center shadow-lg shadow-fuchsia-500/20 group-hover:scale-105 transition-transform">
              <PlayCircle className="w-5 h-5 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tighter text-white">ClipTok</span>
          </Link>

          <div className="hidden lg:flex items-center gap-6 font-semibold text-sm text-zinc-400">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass(l.href)}>
                {l.href === '/ai-editor' ? <span className="bg-gradient-to-r from-fuchsia-400 to-orange-300 bg-clip-text text-transparent">{l.label}</span> : l.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Moniteur GPU seulement sur les grands écrans : il écrasait les liens. */}
          <div className="hidden 2xl:block mr-2">
            <GpuMonitor />
          </div>
          
          <button
            onClick={toggleSound}
            title={soundOn ? 'Couper le son' : 'Activer le son'}
            aria-label={soundOn ? 'Couper le son' : 'Activer le son'}
            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          {!user ? (
            <div className="hidden sm:flex items-center gap-2">
              <Link href="/login" className="text-sm font-bold text-white hover:text-fuchsia-400 px-4 py-2 transition-colors">
                Connexion
              </Link>
              <Link href="/register" className="text-sm font-bold bg-white text-black px-5 py-2.5 rounded-full hover:bg-zinc-200 transition-colors shadow-lg">
                S'inscrire
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className={`hidden sm:flex items-center gap-2 px-5 py-2.5 rounded-full font-bold transition-all shadow-lg whitespace-nowrap ${
                  isActive('/dashboard') && !pathname.startsWith('/dashboard/composer') ? 'bg-white text-black shadow-white/10' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </Link>
              
              <div className="relative ml-2">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 p-1 pr-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full transition-all"
                >
                  <img src={user.avatar} alt="Avatar" className="w-8 h-8 rounded-full" />
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                </button>
                {dropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-black border border-white/10 rounded-xl shadow-2xl py-2 z-50 overflow-hidden">
                      <div className="px-4 py-2 border-b border-white/10 mb-2">
                        <p className="text-sm font-bold text-white truncate">{user.name}</p>
                        <p className="text-xs text-zinc-500 truncate">{user.email}</p>
                      </div>
                      <Link
                        href="/settings"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <Settings className="w-4 h-4" /> Paramètres
                      </Link>
                      <Link
                        href="/ai-usage"
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
                      >
                        <Gauge className="w-4 h-4" /> Usage IA &amp; clés
                      </Link>
                      <button
                        onClick={() => { setDropdownOpen(false); logout(); }}
                        className="w-full flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
                      >
                        <LogOut className="w-4 h-4" /> Déconnexion
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <button
            onClick={() => setMobileOpen((o) => !o)}
            className="lg:hidden w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-white"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden max-w-7xl mx-auto mt-4 flex flex-col gap-1 pb-2">
          {[...links, ...(user ? [] : [{ href: '/login', label: 'Connexion' }])].map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className={mobileLinkClass(l.href)}>
              {l.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
