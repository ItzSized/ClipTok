'use client';
// Force TS server re-parse

import VideoComposer from '@/components/VideoComposer';

export default function ComposerPage() {
  return (
    <div className="flex-1 w-full flex flex-col items-center">
      <VideoComposer />
    </div>
  );
}
