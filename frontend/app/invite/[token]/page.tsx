'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { joinTeam } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import { Loader2, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function InvitePage({ params }: { params: { token: string } }) {
  const { user, updateUser } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) {
      // Si l'utilisateur n'est pas connecté, on le redirige vers le login avec un toast
      showToast({ type: 'error', message: 'Veuillez vous connecter ou créer un compte pour rejoindre l\'équipe.' });
      router.push('/login');
      return;
    }

    const join = async () => {
      try {
        const res = await joinTeam(params.token);
        updateUser({ ...user, teamId: res.team.id });
        setSuccess(true);
      } catch (err: any) {
        setError(err.message || 'Lien invalide.');
      } finally {
        setLoading(false);
      }
    };

    join();
  }, [user, params.token, router, showToast, updateUser]);

  if (!user) return null;

  return (
    <div className="flex-1 w-full flex items-center justify-center p-4 z-10">
      <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl text-center">
        {loading ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 animate-spin text-fuchsia-500 mb-4" />
            <h1 className="text-xl font-bold text-white">Recherche de l'équipe...</h1>
          </div>
        ) : success ? (
          <div className="flex flex-col items-center">
            <CheckCircle2 className="w-16 h-16 text-green-400 mb-4" />
            <h1 className="text-2xl font-black text-white mb-2">Bienvenue dans l'équipe !</h1>
            <p className="text-zinc-400 mb-8">Vous avez rejoint l'équipe avec succès.</p>
            <Link href="/dashboard" className="w-full bg-white text-black font-bold rounded-xl py-3 hover:bg-zinc-200 transition-colors block">
              Aller au Dashboard
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <h1 className="text-2xl font-black text-red-400 mb-2">Erreur</h1>
            <p className="text-zinc-400 mb-8">{error}</p>
            <Link href="/dashboard" className="w-full bg-white/10 text-white font-bold rounded-xl py-3 hover:bg-white/20 transition-colors block">
              Retour à l'accueil
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
