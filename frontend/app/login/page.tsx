'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/AuthProvider';
import { login, guestLogin } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const { login: authLogin } = useAuth();
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { user, token } = await login({ email, password });
      authLogin(token, user);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur de connexion.' });
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      showToast({ type: 'error', message: 'Veuillez saisir votre email/pseudo d\'abord.' });
      return;
    }
    try {
      const { forgotPassword } = await import('@/lib/api');
      const res = await forgotPassword(email);
      showToast({ type: 'success', message: res.message });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    }
  };

  const handleGuestLogin = async () => {
    setLoading(true);
    try {
      const { user, token } = await guestLogin();
      authLogin(token, user);
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur de connexion invité.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 w-full flex items-center justify-center p-4 z-10">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
        <h1 className="text-3xl font-black text-white text-center mb-2">Bienvenue !</h1>
        <p className="text-zinc-400 text-center mb-8">Connectez-vous pour accéder à votre espace.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="block text-sm font-bold text-white mb-2">Email ou Pseudo</label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500 transition-colors"
              placeholder="votre@email.com ou votre pseudo"
              required
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-bold text-white">Mot de passe</label>
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs text-fuchsia-400 hover:text-fuchsia-300 font-semibold"
              >
                Mot de passe oublié ?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/50 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-white focus:outline-none focus:border-fuchsia-500 transition-colors"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white font-bold rounded-xl py-3 mt-4 hover:opacity-90 transition-opacity flex justify-center items-center"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Se connecter'}
          </button>
          
          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink-0 mx-4 text-zinc-500 text-sm">ou</span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          <button
            type="button"
            onClick={handleGuestLogin}
            disabled={loading}
            className="w-full bg-white/5 border border-white/10 text-white font-bold rounded-xl py-3 hover:bg-white/10 transition-colors flex justify-center items-center"
          >
            Continuer en tant qu'invité
          </button>
        </form>
        <p className="text-center text-sm text-zinc-500 mt-8">
          Pas encore de compte ?{' '}
          <Link href="/register" className="text-white font-bold hover:underline">
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  );
}
