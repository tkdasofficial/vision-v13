/** "New project chat": the next chat created in this tab joins this project. */
const KEY = "vision_pending_project";

export function setPendingProject(projectId: string) {
  try { sessionStorage.setItem(KEY, projectId); } catch { /* storage unavailable */ }
}

export function takePendingProject(): string | null {
  try {
    const id = sessionStorage.getItem(KEY);
    if (id) sessionStorage.removeItem(KEY);
    return id || null;
  } catch { return null; }
}

/** Pinned projects first, then most recently updated. */
export function sortProjects<T extends { pinned?: boolean | number | null; updated_at?: string; created_at?: string }>(list: T[]): T[] {
  const stamp = (p: T) => p.updated_at || p.created_at || "";
  return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || stamp(b).localeCompare(stamp(a)));
}

const PROMPT_KEY = "vision_pending_project_prompt";
/** A message typed on a project's page, sent once that project's new chat opens. */
export function setPendingProjectPrompt(projectId: string, text: string) {
  try { sessionStorage.setItem(PROMPT_KEY, JSON.stringify({ projectId, text })); } catch { /* storage unavailable */ }
}
export function takePendingProjectPrompt(projectId: string): string | null {
  try {
    const raw = sessionStorage.getItem(PROMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { projectId?: string; text?: string };
    if (parsed.projectId !== projectId || !parsed.text) return null;
    sessionStorage.removeItem(PROMPT_KEY);
    return parsed.text;
  } catch { return null; }
}
