/**
 * Recovery when a page file fails to download (the dev server restarted, or a new version went live).
 * First try again in place a few times — the screen and any chat in progress stay as they are.
 * Only if that keeps failing on the published site do we reload, at most once per 5 minutes.
 * Never reloads in the dev preview, where reloading caused repeated reload loops.
 */
export const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i;
const KEY = "vision_chunk_reload";
const WINDOW_MS = 5 * 60_000;
export const SOFT_RETRIES = 3;
let pending = false;
let softTries = 0;
let lastSoftTry = 0;

export const isChunkError = (e: unknown) => CHUNK_ERROR_RE.test(String((e as any)?.message ?? e));

/** Delay before the next in-place retry, or null when in-place retries are used up. */
export function nextSoftRetryDelay(now = Date.now()): number | null {
  if (now - lastSoftTry > 30_000) softTries = 0; // a fresh problem gets fresh retries
  if (softTries >= SOFT_RETRIES) return null;
  softTries += 1;
  lastSoftTry = now;
  return 600 * softTries;
}

export function recoverFromChunkError(): boolean {
  if (typeof window === "undefined" || import.meta.env.DEV) return false;
  if (pending) return true;
  let at = 0;
  try { at = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* ignore */ }
  if (Date.now() - at < WINDOW_MS) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { return false; }
  pending = true;
  setTimeout(() => window.location.reload(), 500);
  return true;
}
