'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface FAQItem {
  question: string;
  answer: string;
}

const DEFAULT_ITEMS: FAQItem[] = [
  {
    question: 'De quelles sources puis-je générer des clips ?',
    answer: "Aujourd'hui, ClipTok prend en entrée un lien YouTube public. Collez l'URL, le reste est automatique.",
  },
  {
    question: 'Comment l\'IA choisit-elle les meilleurs moments ?',
    answer:
      "La vidéo est transcrite mot-par-mot puis analysée par un modèle de langage qui repère les passages autonomes, avec une accroche forte et un potentiel de rétention élevé. Chaque clip reçoit un score de viralité.",
  },
  {
    question: 'Le recadrage suit-il vraiment le visage ?',
    answer:
      "Oui : un traqueur de visage analyse chaque segment vidéo et la caméra virtuelle 9:16 se déplace en douceur pour garder l'intervenant cadré.",
  },
  {
    question: 'Puis-je organiser mes clips par projet ?',
    answer: 'Oui, créez des projets pour regrouper les clips issus d\'une même vidéo ou d\'une même série, renommez-les ou supprimez-les à tout moment.',
  },
  {
    question: 'Les légendes et hashtags sont-ils modifiables ?',
    answer: 'Ils sont générés automatiquement par clip et copiables en un clic — vous pouvez les ajuster avant de publier.',
  },
];

export default function FAQ({ items = DEFAULT_ITEMS }: { items?: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3">Questions fréquentes</h2>
      </div>
      <div className="flex flex-col gap-3">
        {items.map((item, i) => {
          const open = openIndex === i;
          return (
            <div
              key={item.question}
              className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(open ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left"
              >
                <span className="font-semibold text-white text-sm sm:text-base">{item.question}</span>
                <ChevronDown
                  className={`w-4 h-4 text-zinc-400 flex-shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
                />
              </button>
              <div
                className="grid transition-all duration-300 ease-out"
                style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <p className="text-zinc-400 text-sm px-6 pb-5 leading-relaxed">{item.answer}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
