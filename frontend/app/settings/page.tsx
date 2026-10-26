'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { updateSettings, createTeam, getTeam } from '@/lib/api';
import { useToast } from '@/components/ToastProvider';
import type { Team, User } from '@/lib/types';
import { Loader2, Copy, Users, Settings as SettingsIcon, Upload } from 'lucide-react';

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  
  const [activeTab, setActiveTab] = useState<'profile' | 'team'>('profile');
  
  // Profile state
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [language, setLanguage] = useState('fr');
  const [bio, setBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Team state
  const [team, setTeam] = useState<Team | null>(null);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setAvatar(user.avatar);
      setLanguage(user.language);
      setBio(user.bio || '');
    }
  }, [user]);

  useEffect(() => {
    if (user?.teamId && activeTab === 'team') {
      const fetchTeam = async () => {
        setLoadingTeam(true);
        try {
          const res = await getTeam(user.teamId!);
          setTeam(res.team);
          setTeamMembers(res.members);
        } catch (err) {
          console.error(err);
        } finally {
          setLoadingTeam(false);
        }
      };
      fetchTeam();
    }
  }, [user?.teamId, activeTab]);

  const resizeAndConvertImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 256;
          let width = img.width;
          let height = img.height;
          
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => reject(new Error('Erreur de lecture de l\'image'));
      };
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const base64 = await resizeAndConvertImage(file);
        setAvatar(base64);
        showToast({ type: 'success', message: 'Avatar chargé avec succès.' });
      } catch (err) {
        showToast({ type: 'error', message: 'Impossible de lire l\'image.' });
      }
    } else {
      showToast({ type: 'error', message: 'Veuillez déposer une image valide.' });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      try {
        const base64 = await resizeAndConvertImage(file);
        setAvatar(base64);
        showToast({ type: 'success', message: 'Avatar chargé avec succès.' });
      } catch (err) {
        showToast({ type: 'error', message: 'Impossible de lire l\'image.' });
      }
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await updateSettings({ name, avatar, language, bio });
      updateUser(res.user);
      showToast({ type: 'success', message: 'Profil mis à jour.' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingTeam(true);
    try {
      const newTeam = await createTeam(newTeamName);
      updateUser({ ...user!, teamId: newTeam.id });
      showToast({ type: 'success', message: 'Équipe créée !' });
    } catch (err: any) {
      showToast({ type: 'error', message: err.message || 'Erreur.' });
    } finally {
      setCreatingTeam(false);
    }
  };

  const copyInviteLink = () => {
    if (!team) return;
    const link = `${window.location.origin}/invite/${team.inviteToken}`;
    navigator.clipboard.writeText(link);
    showToast({ type: 'success', message: 'Lien copié dans le presse-papiers !' });
  };

  if (!user) return null;

  return (
    <div className="flex-1 w-full max-w-4xl mx-auto py-12 px-4 z-10">
      <h1 className="text-3xl font-black text-white mb-8">Paramètres</h1>
      
      <div className="flex gap-4 mb-8 border-b border-white/10 pb-4">
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex items-center gap-2 px-4 py-2 font-bold rounded-full transition-colors ${activeTab === 'profile' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}
        >
          <SettingsIcon className="w-4 h-4" /> Profil
        </button>
        <button
          onClick={() => setActiveTab('team')}
          className={`flex items-center gap-2 px-4 py-2 font-bold rounded-full transition-colors ${activeTab === 'team' ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-white'}`}
        >
          <Users className="w-4 h-4" /> Équipe
        </button>
      </div>

      {activeTab === 'profile' && (
        <form onSubmit={handleSaveProfile} className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="block text-sm font-bold text-white mb-2">Avatar</label>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`flex items-center gap-6 p-6 border-2 border-dashed rounded-2xl transition-colors relative overflow-hidden ${
                isDragging ? 'border-fuchsia-500 bg-fuchsia-500/10' : 'border-white/20 hover:border-white/40 bg-black/20'
              }`}
            >
              <img src={avatar} alt="Avatar" className="w-24 h-24 rounded-full border border-white/20 object-cover bg-black" />
              <div className="flex-1">
                <p className="font-bold text-white mb-1">Glissez & déposez une image ici</p>
                <p className="text-sm text-zinc-500 mb-4">Ou cliquez pour sélectionner un fichier (JPG, PNG)</p>
                <label className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-bold cursor-pointer transition-colors inline-flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Parcourir
                  <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                </label>
              </div>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-bold text-white mb-2">Nom / Pseudo</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-fuchsia-500 transition-colors outline-none"
            />
          </div>
          
          <div>
            <label className="block text-sm font-bold text-white mb-2">Bio / Informations additionnelles</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-fuchsia-500 transition-colors outline-none min-h-[100px]"
              placeholder="Parlez-nous de vous..."
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-white mb-2">Langue de l'interface</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-white focus:border-fuchsia-500 transition-colors outline-none"
            >
              <option value="fr">Français (FR)</option>
              <option value="en">English (EN)</option>
              <option value="es">Español (ES)</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="self-end bg-white text-black font-bold px-8 py-3 rounded-full hover:bg-zinc-200 transition-colors flex items-center gap-2"
          >
            {savingProfile ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Enregistrer les modifications
          </button>
        </form>
      )}

      {activeTab === 'team' && (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
          {user.teamId ? (
            loadingTeam ? (
              <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-fuchsia-500" /></div>
            ) : team ? (
              <div>
                <h2 className="text-2xl font-bold text-white mb-6">Équipe : {team.name}</h2>
                <div className="bg-black/40 border border-white/5 rounded-2xl p-6 mb-8 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-white mb-1">Lien d'invitation</h3>
                    <p className="text-xs text-zinc-500">Partagez ce lien pour inviter des membres.</p>
                  </div>
                  <button
                    onClick={copyInviteLink}
                    className="flex items-center gap-2 bg-fuchsia-500/20 text-fuchsia-400 font-bold px-4 py-2 rounded-xl hover:bg-fuchsia-500/30 transition-colors"
                  >
                    <Copy className="w-4 h-4" /> Copier le lien
                  </button>
                </div>

                <h3 className="text-lg font-bold text-white mb-4">Membres ({teamMembers.length})</h3>
                <div className="flex flex-col gap-3">
                  {teamMembers.map(m => (
                    <div key={m.id} className="flex items-center gap-4 bg-white/5 border border-white/5 p-4 rounded-xl">
                      <img src={m.avatar} alt={m.name} className="w-10 h-10 rounded-full" />
                      <div>
                        <p className="font-bold text-white">{m.name} {m.id === team.ownerId && <span className="text-xs bg-fuchsia-500 text-white px-2 py-0.5 rounded ml-2">Propriétaire</span>}</p>
                        <p className="text-xs text-zinc-500">{m.email}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-zinc-500">Équipe introuvable.</p>
            )
          ) : (
            <div className="text-center py-8">
              <Users className="w-16 h-16 text-zinc-600 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Vous n'avez pas d'équipe</h2>
              <p className="text-zinc-500 mb-8">Créez une équipe pour collaborer et inviter des membres.</p>
              
              <form onSubmit={handleCreateTeam} className="max-w-xs mx-auto flex flex-col gap-4">
                <input
                  type="text"
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="Nom de l'équipe"
                  required
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-fuchsia-500"
                />
                <button
                  type="submit"
                  disabled={creatingTeam}
                  className="w-full bg-white text-black font-bold rounded-xl py-3 hover:bg-zinc-200 transition-colors flex justify-center items-center gap-2"
                >
                  {creatingTeam ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Créer mon équipe'}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
