'use client';

import Landing from '@/components/Landing';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex-1 w-full flex flex-col items-center">
      <Landing onGetStarted={() => router.push('/dashboard')} />
    </div>
  );
}
