import type {
  GenerateClipPayload,
  ClipResult,
  SSEEvent,
  Project,
  User,
  Team,
  Media,
  FontInfo,
  SfxItem,
  CaptionProject,
  EditorProjectSummary,
  EditorProjectDoc,
  RenderResult,
} from './types';
import type { EditorProject } from '@shared/editorCore';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseJsonSafe(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
  });
  const data = await parseJsonSafe(res);
  if (!res.ok) {
    throw new ApiError(data?.error || `Erreur ${res.status}`, res.status);
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

// --- CLIPS ---

export function getClips(): Promise<ClipResult[]> {
  return request<ClipResult[]>('/api/clips');
}

export function deleteClip(clipId: string): Promise<{ success: true }> {
  return request(`/api/clips/${clipId}`, { method: 'DELETE' });
}

export function deleteClips(ids: string[]): Promise<{ success: true; deleted: number }> {
  return request('/api/clips/delete', { method: 'POST', ...json({ ids }) });
}

export function moveClip(clipId: string, projectId: string | null): Promise<{ success: true; clip: ClipResult }> {
  return request(`/api/clips/${clipId}/move`, { method: 'POST', ...json({ projectId }) });
}

// --- PROJECTS ---

export function getProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects');
}

export function createProject(name: string): Promise<Project> {
  return request<Project>('/api/projects', { method: 'POST', ...json({ name }) });
}

export function renameProject(id: string, name: string): Promise<Project> {
  return request<Project>(`/api/projects/${id}`, { method: 'PATCH', ...json({ name }) });
}

export function deleteProject(id: string): Promise<{ success: true }> {
  return request(`/api/projects/${id}`, { method: 'DELETE' });
}

// --- AUTHENTICATION ---

export function login(credentials: { email: string; password: string }): Promise<{ user: User; token: string }> {
  return request('/api/auth/login', { method: 'POST', ...json(credentials) });
}

export function guestLogin(): Promise<{ user: User; token: string }> {
  return request('/api/auth/guest', { method: 'POST' });
}

export function register(data: { email: string; password: string; name?: string }): Promise<{ user: User; token: string }> {
  return request('/api/auth/register', { method: 'POST', ...json(data) });
}

export function getMe(): Promise<{ user: User }> {
  return request('/api/auth/me');
}

export function updateSettings(data: Partial<User>): Promise<{ user: User }> {
  return request('/api/auth/settings', { method: 'PUT', ...json(data) });
}

export function forgotPassword(email: string): Promise<{ success: true; message: string }> {
  return request('/api/auth/forgot-password', { method: 'POST', ...json({ email }) });
}

// --- TEAMS ---

export function createTeam(name: string): Promise<Team> {
  return request('/api/teams', { method: 'POST', ...json({ name }) });
}

export function joinTeam(token: string): Promise<{ success: true; team: Team }> {
  return request('/api/teams/join', { method: 'POST', ...json({ token }) });
}

export function getTeam(id: string): Promise<{ team: Team; members: User[] }> {
  return request(`/api/teams/${id}`);
}

// --- GÉNÉRATION ---

export async function generateClip(payload: GenerateClipPayload): Promise<{ jobId: string }> {
  const data = await request<{ success: boolean; jobId: string }>('/api/generate-clip', { method: 'POST', ...json(payload) });
  if (!data?.success) throw new ApiError('Une erreur est survenue.', 500);
  return data;
}

export function cancelJob(jobId: string): Promise<{ success: true }> {
  return request<{ success: true }>(`/api/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => ({ success: true as const }));
}

export async function uploadCookies(cookiesText: string): Promise<{ success: true }> {
  return request('/api/upload-cookies', { method: 'POST', body: cookiesText, headers: { 'Content-Type': 'text/plain' } });
}

/**
 * Ouvre le flux SSE de progression d'une tâche et route chaque événement vers `onEvent`.
 * Retourne une fonction de nettoyage à appeler pour fermer la connexion.
 */
export function subscribeToJob(jobId: string, onEvent: (event: SSEEvent) => void): () => void {
  const sse = new EventSource(`${API_BASE_URL}/api/jobs/${jobId}/events`);
  let finished = false;

  sse.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'done' || payload.type === 'error') finished = true;
      onEvent(payload);
      if (payload.type === 'closed') sse.close();
    } catch (err) {
      console.error('Erreur de parsing SSE', err);
    }
  };

  sse.onerror = () => {
    sse.close();
    if (!finished) onEvent({ type: 'error', data: { error: 'Connexion au serveur perdue ou tâche introuvable.' } });
  };

  return () => sse.close();
}

/** Attend la fin d'une tâche ; `onProgress` reçoit les événements step/progress. */
export function waitForJob<T = any>(jobId: string, onProgress?: (message: string, percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const close = subscribeToJob(jobId, (event) => {
      if ((event.type === 'step' || event.type === 'progress') && onProgress) onProgress(event.data?.message || '', event.data?.percent ?? 0);
      else if (event.type === 'queued' && onProgress) onProgress("En file d'attente...", 0);
      else if (event.type === 'done') {
        close();
        resolve(event.data as T);
      } else if (event.type === 'error') {
        close();
        reject(new ApiError(event.data?.error || 'Erreur', 500));
      }
    });
  });
}

export function absoluteFileUrl(path: string): string {
  if (!path) return path;
  return path.startsWith('http') || path.startsWith('blob:') || path.startsWith('data:') ? path : `${API_BASE_URL}${path}`;
}

export function downloadUrl(publicUrl: string, name?: string): string {
  return absoluteFileUrl('/api/download?url=' + encodeURIComponent(publicUrl) + (name ? '&name=' + encodeURIComponent(name) : ''));
}

// --- RESSOURCES ---

export function getFonts(): Promise<FontInfo[]> {
  return request('/api/fonts');
}

export function getSfx(): Promise<SfxItem[]> {
  return request('/api/sfx');
}

// --- MÉDIAS ---

export function listMedia(): Promise<Media[]> {
  return request('/api/media');
}

export function getMedia(id: string): Promise<Media> {
  return request(`/api/media/${id}`);
}

export function deleteMedia(id: string): Promise<{ success: true }> {
  return request(`/api/media/${id}`, { method: 'DELETE' });
}

export function deleteManyMedia(ids: string[]): Promise<{ deleted: number }> {
  return request('/api/media/delete-many', { method: 'POST', ...json({ ids }) });
}

export function importClipAsMedia(clipId: string): Promise<Media> {
  return request('/api/media/import-clip', { method: 'POST', ...json({ clipId }) });
}

/** L'IA décrit les visuels demandés qui ne le sont pas encore (description + mots-clés). */
export function describeMedia(ids: string[], signal?: AbortSignal): Promise<{ media: Media[]; errors: { id: string; error: string }[] }> {
  return request('/api/media/describe', { method: 'POST', ...json({ ids }), signal });
}

export function transcribeMedia(id: string, opts: { language: string; model: string; prompt?: string; translate?: boolean }): Promise<{ jobId: string }> {
  return request(`/api/media/${id}/transcribe`, { method: 'POST', ...json(opts) });
}

export function getWaveform(id: string): Promise<{ rate: number; peaks: number[] }> {
  return request(`/api/media/${id}/waveform`);
}

export function mediaThumbnailUrl(id: string): string {
  return `${API_BASE_URL}/api/media/${id}/thumbnail`;
}

/** Upload avec progression (XMLHttpRequest : fetch ne fournit pas la progression d'envoi). */
export function uploadMedia(files: File[], onProgress?: (percent: number) => void): Promise<{ media: Media[]; errors: { name: string; error: string }[] }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/api/media/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch { }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error || `Erreur ${xhr.status}`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Envoi impossible (serveur injoignable).', 0));
    xhr.send(form);
  });
}

// --- SOUS-TITRES ---

export function listCaptionProjects(): Promise<CaptionProject[]> {
  return request('/api/captions/projects');
}

export function createCaptionProject(mediaId: string, preset?: string): Promise<CaptionProject> {
  return request('/api/captions/projects', { method: 'POST', ...json({ mediaId, preset }) });
}

export function getCaptionProject(id: string): Promise<CaptionProject> {
  return request(`/api/captions/projects/${id}`);
}

export function updateCaptionProject(id: string, updates: Partial<Pick<CaptionProject, 'name' | 'words' | 'style' | 'framing' | 'language'>>): Promise<CaptionProject> {
  return request(`/api/captions/projects/${id}`, { method: 'PUT', ...json(updates) });
}

export function deleteCaptionProject(id: string): Promise<{ success: true }> {
  return request(`/api/captions/projects/${id}`, { method: 'DELETE' });
}

export function renderCaptionProject(id: string): Promise<{ jobId: string }> {
  return request(`/api/captions/projects/${id}/render`, { method: 'POST' });
}

export function captionExportUrl(id: string, format: 'srt' | 'vtt' | 'ass' | 'txt'): string {
  return `${API_BASE_URL}/api/captions/projects/${id}/export/${format}`;
}

// --- ÉDITEUR ---

export function listEditorProjects(): Promise<EditorProjectSummary[]> {
  return request('/api/editor/projects');
}

export function createEditorProject(opts: { name?: string; aspect?: string; mediaIds?: string[]; clipId?: string }): Promise<EditorProjectDoc> {
  return request('/api/editor/projects', { method: 'POST', ...json(opts) });
}

export function getEditorProject(id: string): Promise<EditorProjectDoc> {
  return request(`/api/editor/projects/${id}`);
}

export function saveEditorProject(id: string, updates: { name?: string; project?: EditorProject }): Promise<EditorProjectSummary> {
  return request(`/api/editor/projects/${id}`, { method: 'PUT', ...json(updates) });
}

export function duplicateEditorProject(id: string): Promise<EditorProjectSummary> {
  return request(`/api/editor/projects/${id}/duplicate`, { method: 'POST' });
}

export function deleteEditorProject(id: string): Promise<{ success: true }> {
  return request(`/api/editor/projects/${id}`, { method: 'DELETE' });
}

export function exportEditorProject(id: string, body: { project: EditorProject; quality: string; rasters: Record<string, string>; fingerprint?: string }): Promise<{ jobId: string }> {
  return request(`/api/editor/projects/${id}/export`, { method: 'POST', ...json(body) });
}

// --- IA (fournisseurs gratuits) ---

export interface AiProvider {
  id: string;
  name: string;
  configured: boolean;
  model: string | null;
}

export function getAiProviders(): Promise<AiProvider[]> {
  return request('/api/ai/providers');
}

export function getAiModels(provider: string): Promise<string[]> {
  return request(`/api/ai/models?provider=${encodeURIComponent(provider)}`);
}

export type AiMode = 'fast' | 'balanced' | 'max';

export interface AiSearch {
  query: string;
  engine?: string;
  sources: { title: string; url: string }[];
}

export interface AiUsageModel {
  model: string;
  requests: number;
  ok: number;
  errors: number;
  rateLimited: number;
  tokensIn: number;
  tokensOut: number;
  lastAt: string | null;
  status: string;
  until: string | null;
}

export interface AiUsageReport {
  day: string;
  resetAt: string;
  providers: {
    id: string;
    name: string;
    cooledModels: { model: string; reason: string; until: string }[];
    keys: { id: string; masked: string; project: { letter: string; size: number } | null; source: 'env' | 'site'; status: string; requests: number; ok: number; rateLimited: number; tokens: number; models: AiUsageModel[] }[];
  }[];
}

export function getAiUsage(): Promise<AiUsageReport> {
  return request('/api/ai/usage');
}

export function addAiKeys(provider: string, keys: string): Promise<{ added: number }> {
  return request('/api/ai/keys', { method: 'POST', ...json({ provider, keys }) });
}

export function removeAiKey(provider: string, id: string): Promise<{ success: true }> {
  return request(`/api/ai/keys/${provider}/${id}`, { method: 'DELETE' });
}

export interface AiMemory {
  id: string;
  text: string;
  media: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
}

export function getAiMemory(): Promise<AiMemory[]> {
  return request('/api/ai/memory');
}

export function addAiMemory(entry: { text: string; media?: { id: string; name: string }[] }): Promise<AiMemory> {
  return request('/api/ai/memory', { method: 'POST', ...json(entry) });
}

export function updateAiMemory(id: string, entry: { text: string; media?: { id: string; name: string }[] }): Promise<AiMemory> {
  return request(`/api/ai/memory/${id}`, { method: 'PATCH', ...json(entry) });
}

export function deleteAiMemory(id: string): Promise<{ success: true }> {
  return request(`/api/ai/memory/${id}`, { method: 'DELETE' });
}

export interface AiEditResponse {
  remember?: { text: string; media: string[] }[];
  forget?: string[];
  reply: string;
  actions: Record<string, any>[];
  provider: string;
  model: string;
  searches?: AiSearch[];
}

export function aiEdit(
  body: { request: string; history: { role: 'user' | 'assistant'; content: string }[]; context: unknown; provider?: string; model?: string; mode?: AiMode; webSearch?: boolean },
  signal?: AbortSignal
): Promise<AiEditResponse> {
  return request('/api/ai/edit', { method: 'POST', ...json(body), signal });
}

export interface BrollPlacement {
  media: string;
  start: number;
  duration: number;
  trim_start?: number;
  why?: string;
}

/** B-roll automatique : l'IA choisit quels médias montrer pendant quelles phrases. */
export function aiBroll(
  body: {
    segments: { start: number; end: number; text: string }[];
    media: { id: string; name: string; kind: string; duration: number; desc?: string; tags?: string[]; text?: string }[];
    duration: number;
    instructions?: string;
    provider?: string;
    model?: string;
    mode?: AiMode;
  },
  signal?: AbortSignal
): Promise<{ placements: BrollPlacement[]; provider: string; model: string }> {
  return request('/api/ai/broll', { method: 'POST', ...json(body), signal });
}

export interface SocialCaptionResult {
  title: string;
  description: string;
  hashtags: string[];
  provider?: string;
}

export function generateSocialCaption(body: { title?: string; transcript?: string; clipNames?: string[]; duration?: number }): Promise<SocialCaptionResult> {
  return request('/api/ai/social-caption', { method: 'POST', ...json(body) });
}

export type { RenderResult };
