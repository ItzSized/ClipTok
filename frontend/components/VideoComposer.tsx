'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, X, GripVertical, Settings, PlayCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ToastProvider';

interface ClipFile {
  id: string;
  file: File;
  previewUrl: string;
}

export default function VideoComposer() {
  const [clips, setClips] = useState<ClipFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  
  const [settings, setSettings] = useState({
    outputFormat: '9:16',
    resolution: '1080p',
    fps: '30',
    audioNormalize: true
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files).filter(f => f.type.startsWith('video/'));
    
    // Sort naturally by filename
    newFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const newClips = newFiles.map(f => ({
      id: Math.random().toString(36).substring(2, 9),
      file: f,
      previewUrl: URL.createObjectURL(f)
    }));
    
    setClips(prev => [...prev, ...newClips]);
  };

  const removeClip = (id: string) => {
    setClips(prev => {
      const clip = prev.find(c => c.id === id);
      if (clip) URL.revokeObjectURL(clip.previewUrl);
      return prev.filter(c => c.id !== id);
    });
  };

  // Very simple drag and drop reordering
  const [draggedId, setDraggedId] = useState<string | null>(null);
  
  const handleDragStart = (id: string) => setDraggedId(id);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setClips(prev => {
      const result = [...prev];
      const draggedIdx = result.findIndex(c => c.id === draggedId);
      const targetIdx = result.findIndex(c => c.id === targetId);
      const [draggedItem] = result.splice(draggedIdx, 1);
      result.splice(targetIdx, 0, draggedItem);
      return result;
    });
    setDraggedId(null);
  };

  const startRender = async () => {
    if (clips.length === 0) return;
    setLoading(true);
    setProgress(0);
    setStatusMessage('Initialisation...');
    setResultUrl(null);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      
      // 1. Init Job
      const initRes = await fetch(`${API_URL}/api/composer/init`, { method: 'POST' });
      const { jobId } = await initRes.json();
      
      // 2. Upload
      setStatusMessage('Envoi des fichiers...');
      const formData = new FormData();
      clips.forEach(c => formData.append('clips', c.file));
      
      const uploadRes = await fetch(`${API_URL}/api/composer/${jobId}/upload`, {
        method: 'POST',
        body: formData
      });
      const uploadData = await uploadRes.json();
      if (!uploadData.success) throw new Error('Upload échoué');

      // Setup SSE before render
      const evtSource = new EventSource(`${API_URL}/api/composer/${jobId}/status`);
      
      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'step') {
          setStatusMessage(data.data.message);
          if (data.data.percent >= 0) setProgress(data.data.percent);
        } else if (data.type === 'progress') {
          setStatusMessage(data.data.message);
          setProgress(data.data.percent);
        } else if (data.type === 'done') {
          setResultUrl(data.data.videoUrl);
          setLoading(false);
          setStatusMessage('Rendu terminé !');
          setProgress(100);
          evtSource.close();
          showToast({ type: 'success', message: 'Vidéo assemblée avec succès !' });
        } else if (data.type === 'error') {
          setLoading(false);
          evtSource.close();
          showToast({ type: 'error', message: data.data.error || 'Erreur pendant le rendu.' });
        } else if (data.type === 'closed') {
          setLoading(false);
          evtSource.close();
        }
      };

      // 3. Render
      const renderPayload = {
        clips: uploadData.files.map((f: { id: string }) => ({ id: f.id })),
        settings
      };
      
      const renderRes = await fetch(`${API_URL}/api/composer/${jobId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renderPayload)
      });
      if (!renderRes.ok) {
        evtSource.close();
        const err = await renderRes.json().catch(() => null);
        throw new Error(err?.error || 'Rendu impossible.');
      }

    } catch (err: any) {
      setLoading(false);
      showToast({ type: 'error', message: err.message || 'Une erreur est survenue.' });
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 flex flex-col gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-black text-white">Video Composer</h1>
        <p className="text-zinc-400 mt-2">Combine multiple clips into one seamless video.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Clips */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div 
            className="border-2 border-dashed border-white/20 rounded-2xl p-10 flex flex-col items-center justify-center bg-black/20 hover:bg-white/5 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              multiple 
              accept="video/*" 
              onChange={handleFileSelect} 
            />
            <Upload className="w-10 h-10 text-zinc-500 mb-4" />
            <p className="font-bold text-white text-lg">Drop your clips here</p>
            <p className="text-sm text-zinc-500 mt-1">Supports MP4, MOV, WEBM</p>
          </div>

          <div className="flex flex-col gap-2">
            {clips.map((clip, i) => (
              <div 
                key={clip.id}
                draggable
                onDragStart={() => handleDragStart(clip.id)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(clip.id)}
                className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/10 group cursor-move"
              >
                <GripVertical className="w-5 h-5 text-zinc-600" />
                <div className="font-bold text-white/50 w-6">{i + 1}</div>
                <video src={clip.previewUrl} className="w-16 h-16 object-cover rounded-lg bg-black" />
                <div className="flex-1 overflow-hidden">
                  <p className="font-bold text-sm text-white truncate">{clip.file.name}</p>
                  <p className="text-xs text-zinc-500">{(clip.file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button onClick={() => removeClip(clip.id)} className="p-2 text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Settings & Actions */}
        <div className="flex flex-col gap-6">
          <div className="bg-white/5 border border-white/10 p-6 rounded-3xl flex flex-col gap-4">
            <h2 className="font-bold text-white flex items-center gap-2">
              <Settings className="w-5 h-5 text-fuchsia-400" />
              Configuration
            </h2>
            
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-zinc-400">Output Format</label>
              <select className="bg-black/50 border border-white/10 p-3 rounded-xl text-sm outline-none text-white focus:border-fuchsia-500" value={settings.outputFormat} onChange={e => setSettings({...settings, outputFormat: e.target.value})}>
                <option value="9:16">Vertical 9:16</option>
                <option value="16:9">Horizontal 16:9</option>
                <option value="1:1">Square 1:1</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-zinc-400">Quality</label>
              <select className="bg-black/50 border border-white/10 p-3 rounded-xl text-sm outline-none text-white focus:border-fuchsia-500" value={settings.resolution} onChange={e => setSettings({...settings, resolution: e.target.value})}>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="4k">4K (UHD)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-zinc-400">Transitions (Phase 1)</label>
              <select className="bg-black/50 border border-white/10 p-3 rounded-xl text-sm outline-none text-white" disabled>
                <option>Simple Merge</option>
              </select>
            </div>
          </div>

          <button
            onClick={startRender}
            disabled={loading || clips.length === 0}
            className="w-full bg-gradient-to-r from-fuchsia-500 to-orange-500 text-white font-black py-4 rounded-3xl shadow-lg hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <PlayCircle className="w-6 h-6" />}
            CREATE VIDEO
          </button>

          {loading && (
            <div className="bg-white/5 border border-white/10 p-4 rounded-3xl">
              <div className="flex justify-between text-xs font-bold text-zinc-400 mb-2">
                <span>{statusMessage}</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-black rounded-full h-2 overflow-hidden">
                <div className="bg-gradient-to-r from-fuchsia-500 to-orange-500 h-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {resultUrl && (
            <div className="bg-white/5 border border-white/10 p-4 rounded-3xl flex flex-col gap-4">
              <p className="font-bold text-white text-center">Video Ready!</p>
              <video src={process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${resultUrl}` : resultUrl} controls className="w-full rounded-xl bg-black" />
              <a href={process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}/api/download?url=${encodeURIComponent(resultUrl)}` : `/api/download?url=${encodeURIComponent(resultUrl)}`} download className="w-full bg-white text-black font-bold py-3 rounded-xl text-center text-sm hover:bg-zinc-200">
                Download
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
