import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ToastProvider';
import { DialogProvider } from '@/components/DialogProvider';

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' });

const SITE_DESCRIPTION =
  "ClipTok transforme vos vidéos YouTube en clips verticaux viraux : curation IA, recadrage qui suit le visage, sous-titres animés, légendes et hashtags générés automatiquement.";

export const metadata: Metadata = {
  title: {
    default: 'ClipTok — Clips viraux générés par IA',
    template: '%s · ClipTok',
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: 'ClipTok — Clips viraux générés par IA',
    description: SITE_DESCRIPTION,
    type: 'website',
    locale: 'fr_FR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClipTok — Clips viraux générés par IA',
    description: SITE_DESCRIPTION,
  },
};

import Navbar from '@/components/Navbar';
import AuthProvider from '@/components/AuthProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={manrope.variable}>
      <body className="font-sans min-h-screen bg-[#0a0a0a] text-zinc-100 flex flex-col selection:bg-fuchsia-500/30">
        <AuthProvider>
          <ToastProvider>
            <DialogProvider>
              <Navbar />
              <div className="flex-1 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-fuchsia-600/10 blur-[120px] rounded-full pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-orange-600/10 blur-[120px] rounded-full pointer-events-none" />
                {children}
              </div>
            </DialogProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
