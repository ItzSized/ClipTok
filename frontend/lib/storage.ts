export const RECENT_URLS_KEY = 'cliptok:recent-urls';
export const GENERATOR_SETTINGS_KEY = 'cliptok:generator-settings';

export function getJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setJSON<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota dépassé ou stockage désactivé : on ignore silencieusement.
  }
}

export function pushRecentUrl(url: string, max = 5): string[] {
  const current = getJSON<string[]>(RECENT_URLS_KEY, []);
  const next = [url, ...current.filter((u) => u !== url)].slice(0, max);
  setJSON(RECENT_URLS_KEY, next);
  return next;
}
