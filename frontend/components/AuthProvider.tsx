'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getMe, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: () => {},
  logout: () => {},
  updateUser: () => {}
});

export const useAuth = () => useContext(AuthContext);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const [waitingServer, setWaitingServer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Au lancement (npm run dev), le frontend est souvent prêt avant le backend :
    // une erreur réseau ne doit pas déconnecter l'utilisateur, on réessaie.
    const fetchUser = async (attempt = 0): Promise<void> => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const { user } = await getMe();
        if (!cancelled) setUser(user);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if ((status === 0 || status >= 500) && attempt < 30 && !cancelled) {
          setWaitingServer(true);
          await new Promise((r) => setTimeout(r, 1000));
          return fetchUser(attempt + 1);
        }
        // Jeton refusé (401/404) : on déconnecte.
        if (status === 401 || status === 404) localStorage.removeItem('token');
      }
      if (!cancelled) {
        setWaitingServer(false);
        setLoading(false);
      }
    };
    fetchUser();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const isAuthRoute = pathname === '/login' || pathname === '/register' || pathname === '/';
    if (!user && !isAuthRoute && !pathname.startsWith('/invite')) {
      router.push('/login');
    } else if (user && isAuthRoute) {
      router.push('/dashboard');
    }
  }, [user, loading, pathname, router]);

  const login = (token: string, userData: User) => {
    localStorage.setItem('token', token);
    setUser(userData);
    router.push('/dashboard');
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    router.push('/login');
  };

  const updateUser = (userData: User) => {
    setUser(userData);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {loading ? (
        <div className="min-h-screen bg-black flex items-center justify-center text-zinc-400 text-sm">{waitingServer ? 'Démarrage du serveur…' : 'Chargement…'}</div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}
