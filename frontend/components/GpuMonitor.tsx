'use client';

import { useEffect, useState } from 'react';
import { Cpu, Activity, Thermometer } from 'lucide-react';
import { absoluteFileUrl } from '@/lib/api';

interface GpuStats {
  utilization: number;
  vramUsed: number;
  vramTotal: number;
  temperature: number;
  name: string;
}

export default function GpuMonitor() {
  const [stats, setStats] = useState<GpuStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(absoluteFileUrl('/api/gpu-stats'));
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        // Ignorer silencieusement si le backend n'est pas dispo
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  if (!stats) return null;

  return (
    <div className="flex items-center gap-4 bg-zinc-900/80 border border-white/10 rounded-2xl px-4 py-2 text-xs font-medium backdrop-blur-md">
      <div className="flex items-center gap-1.5 text-zinc-300 border-r border-white/10 pr-4">
        <Cpu className="w-3.5 h-3.5 text-fuchsia-400" />
        <span className="hidden sm:inline">{stats.name}</span>
        <span className="sm:hidden">GPU</span>
      </div>
      
      <div className="flex items-center gap-1.5" title="Utilisation GPU">
        <Activity className={`w-3.5 h-3.5 ${stats.utilization > 80 ? 'text-red-400' : 'text-orange-400'}`} />
        <span className={stats.utilization > 80 ? 'text-red-300 font-bold' : 'text-zinc-300'}>
          {stats.utilization}%
        </span>
      </div>
      
      <div className="flex items-center gap-1.5 text-zinc-300" title="VRAM (Mémoire Vidéo)">
        <div className="w-16 h-1.5 bg-black rounded-full overflow-hidden shrink-0">
          <div 
            className={`h-full ${stats.vramUsed / stats.vramTotal > 0.8 ? 'bg-red-500' : 'bg-fuchsia-500'}`} 
            style={{ width: `${(stats.vramUsed / stats.vramTotal) * 100}%` }}
          />
        </div>
        <span>{Math.round(stats.vramUsed / 1024)}GB / {Math.round(stats.vramTotal / 1024)}GB</span>
      </div>
      
      <div className="flex items-center gap-1.5" title="Température">
        <Thermometer className={`w-3.5 h-3.5 ${stats.temperature > 80 ? 'text-red-400' : 'text-blue-400'}`} />
        <span className={stats.temperature > 80 ? 'text-red-300 font-bold' : 'text-zinc-300'}>
          {stats.temperature}°C
        </span>
      </div>
    </div>
  );
}
