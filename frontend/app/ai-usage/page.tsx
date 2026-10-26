'use client';

import { Gauge } from 'lucide-react';
import AiUsagePanel from '@/components/ai-editor/AiUsagePanel';

export default function AiUsagePage() {
  return (
    <div className="relative z-10 w-full max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-orange-400 flex items-center justify-center">
          <Gauge className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-white">Usage IA & clés</h1>
          <p className="text-sm text-zinc-500">Requêtes, jetons et quotas de chaque clé gratuite, aujourd’hui. Les clés tournent toutes seules.</p>
        </div>
      </div>
      <AiUsagePanel />
    </div>
  );
}
