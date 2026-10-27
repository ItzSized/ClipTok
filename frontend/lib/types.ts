export interface ClipResult {
  id: string;
  videoUrl: string;
  audioUrl?: string;
  title: string;
  viralityScore: number;
  reason?: string;
  caption?: string;
  hashtags?: string[];
  clipStart: number;
  clipEnd: number;
  sourceTitle?: string;
  createdAt?: string;
}
export interface Project {
  id: string;
  name: string;
  createdAt: string;
  clips: ClipResult[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  language: string;
  bio: string;
  teamId: string | null;
}

export interface Team {
  id: string;
  name: string;
  ownerId: string;
  inviteToken: string;
}

export type SpeedMode = 'ultra_fast' | 'fast' | 'normal' | 'precise';
export type VideoQuality = '720p' | '1080p' | '4k';
export type VideoFormat = 'portrait' | 'landscape';

export interface GenerateClipPayload {
  youtubeUrl: string;
  quality: VideoQuality;
  targetDuration: number;
  speedMode: SpeedMode;
  withSubtitles: boolean;
  captionStyle?: string;
  aiProvider?: string;
  format: VideoFormat;
  clipCount: number | 'auto';
  videoSpeed: number;
  projectId?: string;
}

export type SSEEventType = 'queued' | 'step' | 'estimate' | 'progress' | 'done' | 'error' | 'closed';

export interface SSEEvent {
  type: SSEEventType;
  data?: any;
}

// --- Médias, sous-titres, éditeur ---

export type MediaKind = 'video' | 'audio' | 'image';

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  loud?: boolean;
  probability?: number;
}

export interface Media {
  id: string;
  name: string;
  kind: MediaKind;
  url: string;
  source: 'upload' | 'clip' | string;
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  createdAt: string;
  updatedAt: string;
  /** Liste : résumé ; détail (GET /api/media/:id) : mots complets. */
  transcript: { language: string; model: string; wordCount?: number; words?: TranscriptWord[] } | null;
  /** Traduction anglaise de la voix (détail uniquement ; `translated` dans les listes). */
  transcriptEn?: { language: string; model: string; words?: TranscriptWord[] } | null;
  translated?: boolean;
  /** Ce que l'IA voit dans le média (B-roll automatique). */
  vision?: { description: string; tags: string[]; text?: string; model?: string } | null;
  /** Dossier de la bibliothèque audio (sur D:) : musique, son court ou voix off générée. */
  library?: 'music' | 'sfx' | 'voice' | null;
  /** Voix off générée : voix et texte d'origine. */
  tts?: { voice: string; text: string; rate: number; pitch: number } | null;
}

export interface Voice {
  id: string;
  name: string;
  desc: string;
  lang: string;
  gender: 'male' | 'female';
  provider: 'edge' | 'elevenlabs';
}

export interface FontInfo {
  id: string;
  file: string;
  url: string;
  assName: string;
  family: string;
  fullName: string;
  weight: number;
  emRatio: number;
  ascentRatio: number;
}

export interface SfxItem {
  id: string;
  name: string;
  category: string;
  url: string;
  duration: number;
}

export interface CaptionFraming {
  aspect: 'original' | '9:16' | '1:1' | '4:5' | '16:9';
  fit: 'crop' | 'blur' | 'black';
  cropX: number;
}

export interface RenderResult {
  videoUrl: string;
  createdAt: string;
  width: number;
  height: number;
  duration?: number;
  quality?: string;
  /** Empreinte du projet exporté : sert à savoir si l'export est encore à jour. */
  fingerprint?: string;
}

export interface CaptionProject {
  id: string;
  name: string;
  mediaId: string;
  media: Media | null;
  words: TranscriptWord[];
  wordCount?: number;
  language: string | null;
  style: import('@shared/captionEngine').CaptionStyle;
  framing: CaptionFraming;
  lastRender: RenderResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface EditorProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: import('@shared/editorCore').ProjectSettings;
  duration: number;
  clipCount: number;
  thumbnailUrl: string | null;
  lastExport: RenderResult | null;
}

export interface EditorProjectDoc {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  project: import('@shared/editorCore').EditorProject;
  lastExport: RenderResult | null;
}
