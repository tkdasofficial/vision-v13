// Chat "@" picker helpers. The plugin list itself lives in ./plugins/manifest.ts.
import type { PluginDef } from "@/lib/plugins/manifest";

/** Finds an active "@query" right before the caret (start of text or after whitespace). */
export function findMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^@\n]{0,30})$/.exec(before);
  if (!m) return null;
  const query = m[2];
  if (/\s{2,}/.test(query)) return null;
  return { start: before.length - query.length - 1, query };
}

/** Narrows the user's added plugins by what was typed after "@" (no separate search box). */
export function filterPlugins(list: PluginDef[], query: string): PluginDef[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter((p) => p.name.toLowerCase().includes(q) || (p.exts ?? []).some((e) => e.startsWith(q))) : list;
}

/** Removes the "@query" at start..caret (the plugin becomes a chip instead of text). */
export function removeMention(text: string, start: number, caret: number) {
  return { text: text.slice(0, start) + text.slice(caret).replace(/^ /, ""), caret: start };
}

/** Replaces the "@query" at start..caret with "@Name ". */
export function insertMention(text: string, start: number, caret: number, name: string) {
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + text.slice(caret), caret: start + insert.length };
}
