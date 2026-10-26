'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import FAQ, { FAQItem } from './landing/FAQ';

const PRICING_FAQ: FAQItem[] = [
  {
    question: 'Puis-je changer de forfait à tout moment ?',
    answer: 'Oui, vous pouvez passer à un forfait supérieur ou inférieur quand vous le souhaitez.',
  },
  {
    question: 'Que se passe-t-il si je dépasse mes minutes de traitement ?',
    answer: 'Vous êtes prévenu avant la limite et pouvez passer au forfait supérieur en un clic.',
  },
  {
    question: 'Le forfait annuel est-il vraiment moins cher ?',
    answer: "Oui, l'engagement annuel équivaut à 2 mois offerts par rapport au paiement mensuel.",
  },
];

export default function Pricing() {
  const [annual, setAnnual] = useState(false);

  const price = (monthly: number) => (annual ? Math.round(monthly * 10) : monthly);

  return (
    <div className="w-full max-w-6xl flex flex-col items-center relative z-10 py-12 gap-20">
      <div className="w-full">
        <div className="text-center space-y-4 mb-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white">Des tarifs simples.</h1>
          <p className="text-xl text-zinc-400">Commencez gratuitement, passez pro quand vous devenez viral.</p>
        </div>

        <div className="flex justify-center mb-14">
          <div className="inline-flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
            <button
              onClick={() => setAnnual(false)}
              className={`px-5 py-2 rounded-full text-sm font-bold transition-colors ${!annual ? 'bg-white text-black' : 'text-zinc-400'}`}
            >
              Mensuel
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-bold transition-colors ${annual ? 'bg-white text-black' : 'text-zinc-400'}`}
            >
              Annuel
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-gradient-to-r from-fuchsia-500 to-orange-400 text-white">
                -17%
              </span>
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 w-full">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col hover:border-white/20 transition-colors">
            <h3 className="text-2xl font-bold text-white mb-2">Gratuit</h3>
            <p className="text-zinc-400 mb-6">Pour tester la puissance de l'IA.</p>
            <div className="mb-8">
              <span className="text-5xl font-extrabold text-white">0€</span>
              <span className="text-zinc-500">/mois</span>
            </div>
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3 text-zinc-300"><Check className="w-5 h-5 text-fuchsia-400" /> 60 minutes de traitement</li>
              <li className="flex items-center gap-3 text-zinc-300"><Check className="w-5 h-5 text-fuchsia-400" /> Qualité 720p</li>
              <li className="flex items-center gap-3 text-zinc-300"><Check className="w-5 h-5 text-fuchsia-400" /> Filigrane ClipTok</li>
            </ul>
            <button className="w-full py-4 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 transition-colors">
              C'est parti
            </button>
          </div>

          <div className="bg-gradient-to-b from-fuchsia-500/20 to-orange-500/10 border border-fuchsia-500/50 rounded-3xl p-8 flex flex-col relative transform md:-translate-y-4 shadow-2xl shadow-fuchsia-500/20">
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-fuchsia-500 to-orange-500 px-4 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wider shadow-lg">
              Recommandé
            </div>
            <h3 className="text-2xl font-bold text-fuchsia-300 mb-2">Creator Pro</h3>
            <p className="text-fuchsia-200/60 mb-6">Pour les créateurs sérieux.</p>
            <div className="mb-8">
              <span className="text-5xl font-extrabold text-white">{price(19)}€</span>
              <span className="text-fuchsia-200/50">/{annual ? 'an' : 'mois'}</span>
            </div>
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-fuchsia-400" /> 500 minutes de traitement</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-fuchsia-400" /> Qualité 1080p HD</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-fuchsia-400" /> Sans filigrane</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-fuchsia-400" /> Vitesse "Précise" débloquée</li>
              <li className="flex items-center gap-3 text-white"><Check className="w-5 h-5 text-fuchsia-400" /> Légendes & hashtags IA</li>
            </ul>
            <button className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-fuchsia-500 to-orange-500 hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-fuchsia-500/25">
              Devenir Pro
            </button>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col hover:border-white/20 transition-colors">
            <h3 className="text-2xl font-bold text-white mb-2">Agency Max</h3>
            <p className="text-zinc-400 mb-6">Pour les agences et gros volumes.</p>
            <div className="mb-8">
              <span className="text-5xl font-extrabold text-white">{price(49)}€</span>
              <span className="text-zinc-500">/{annual ? 'an' : 'mois'}</span>
            </div>
            <ul className="space-y-4 mb-8 flex-1">
              <li className="flex items-center gap-3 text-zinc-300"><Check className="w-5 h-5 text-fuchsia-400" /> Minutes illimitées</li>
              <li className="flex items-center gap-3 text-zinc-300"><Check className="w-5 h-5 text-fuchsia-400" /> Qualité 4K</li>
              <li className="flex items-center gap-3 text-zinc-300"><Check className="w-5 h-5 text-fuchsia-400" /> Support prioritaire</li>
            </ul>
            <button className="w-full py-4 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 transition-colors">
              Contacter les ventes
            </button>
          </div>
        </div>
      </div>

      <FAQ items={PRICING_FAQ} />
    </div>
  );
}
