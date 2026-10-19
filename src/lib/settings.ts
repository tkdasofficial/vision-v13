// User preferences shared by Settings pages, the app shell and the chat server. Browser-safe.
import type { ChatMode } from "@/lib/ai/modes";
import { normalizeSelection } from "@/lib/plugins/manifest";

export type Prefs = {
  theme: "system" | "light" | "dark";
  accent: "mono" | "blue" | "green" | "orange" | "rose";
  fontSize: "sm" | "md" | "lg";
  defaultMode: ChatMode;
  responseLength: "concise" | "balanced" | "detailed";
  tone: "neutral" | "friendly" | "formal";
  customInstructions: string;
  webSearch: "auto" | "always" | "off";
  codeComments: boolean;
  codeExplain: "brief" | "full";
  reduceMotion: boolean;
  highContrast: boolean;
  largeTargets: boolean;
  notifyReplies: boolean;
  notifyResearch: boolean;
  /** Plugins added to the chat "@" picker; null = never changed (defaults apply). */
  plugins: string[] | null;
};

export const DEFAULT_PREFS: Prefs = {
  theme: "system", accent: "mono", fontSize: "md", defaultMode: "default",
  responseLength: "balanced", tone: "neutral", customInstructions: "", webSearch: "auto",
  codeComments: true, codeExplain: "brief", reduceMotion: false, highContrast: false,
  largeTargets: false, notifyReplies: false, notifyResearch: true, plugins: null,
};

export const MAX_INSTRUCTIONS = 1000;
const CACHE_KEY = "vision_prefs";

const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/** Validates untrusted JSON (browser cache or DB) into a complete Prefs object. */
export function parsePrefs(raw: unknown): Prefs {
  let o: any = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { o = {}; } }
  if (!o || typeof o !== "object") o = {};
  const d = DEFAULT_PREFS;
  const bool = (v: unknown, b: boolean) => (typeof v === "boolean" ? v : b);
  return {
    theme: pick(o.theme, ["system", "light", "dark"], d.theme),
    accent: pick(o.accent, ["mono", "blue", "green", "orange", "rose"], d.accent),
    fontSize: pick(o.fontSize, ["sm", "md", "lg"], d.fontSize),
    defaultMode: pick(o.defaultMode, ["default", "deep", "research", "coding"], d.defaultMode),
    responseLength: pick(o.responseLength, ["concise", "balanced", "detailed"], d.responseLength),
    tone: pick(o.tone, ["neutral", "friendly", "formal"], d.tone),
    customInstructions: typeof o.customInstructions === "string" ? o.customInstructions.slice(0, MAX_INSTRUCTIONS) : "",
    webSearch: pick(o.webSearch, ["auto", "always", "off"], d.webSearch),
    codeComments: bool(o.codeComments, d.codeComments),
    codeExplain: pick(o.codeExplain, ["brief", "full"], d.codeExplain),
    reduceMotion: bool(o.reduceMotion, d.reduceMotion),
    highContrast: bool(o.highContrast, d.highContrast),
    largeTargets: bool(o.largeTargets, d.largeTargets),
    notifyReplies: bool(o.notifyReplies, d.notifyReplies),
    notifyResearch: bool(o.notifyResearch, d.notifyResearch),
    plugins: Array.isArray(o.plugins) ? normalizeSelection(o.plugins) : null,
  };
}

export function readCachedPrefs(): Prefs {
  try { return parsePrefs(localStorage.getItem(CACHE_KEY)); } catch { return DEFAULT_PREFS; }
}
export function cachePrefs(p: Prefs) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/** Applies visual preferences to <html>. */
export function applyPrefs(p: Prefs) {
  const el = document.documentElement;
  el.classList.toggle("dark", p.theme === "dark");
  el.classList.toggle("light", p.theme === "light");
  el.dataset.accent = p.accent;
  el.dataset.fontSize = p.fontSize;
  el.classList.toggle("reduce-motion", p.reduceMotion);
  el.classList.toggle("high-contrast", p.highContrast);
  el.classList.toggle("large-targets", p.largeTargets);
}

/** Extra system-prompt lines built from the user's AI preferences (server-side use). */
export function promptAddendum(p: Prefs, opts: { personal?: boolean } = {}): string {
  const lines: string[] = [];
  if (p.responseLength === "concise") lines.push("Keep answers short and to the point.");
  if (p.responseLength === "detailed") lines.push("Give thorough, detailed answers.");
  if (p.tone === "friendly") lines.push("Use a warm, friendly tone.");
  if (p.tone === "formal") lines.push("Use a formal, professional tone.");
  lines.push(p.codeComments ? "When writing code, include helpful comments." : "When writing code, keep comments minimal.");
  if (p.codeExplain === "full") lines.push("Explain code step by step after writing it.");
  // Project-only memory keeps personal custom instructions out of the project.
  if (opts.personal !== false && p.customInstructions.trim()) lines.push(`User's custom instructions (follow unless unsafe):\n${p.customInstructions.trim()}`);
  return lines.join("\n");
}
