// Shared, provider-neutral pieces of the public repository analyzers. Pure: no network here.
// Each provider (github/gitlab/bitbucket.server.ts) owns its own URLs, retrieval and error mapping.

export type RepoProvider = "github" | "gitlab" | "bitbucket";
export type RepoRef = { owner: string; name: string; path: string };
export type RepoSnapshot = {
  provider: RepoProvider; fullName: string; url: string; description: string; defaultBranch: string;
  stars?: number; language?: string; license?: string;
  readme?: string; tree: string[]; treeTruncated: boolean;
  files: { path: string; text: string }[]; missing: string[];
};
export type RepoErrorCode = "invalid" | "not_found" | "private" | "rate_limited" | "timeout" | "unavailable";
export class RepoError extends Error { constructor(public code: RepoErrorCode, message: string) { super(message); } }

export const REPO_LIMITS = { timeoutMs: 10_000, maxFileBytes: 150_000, maxFiles: 8, maxTree: 3000 } as const;
const HOST: Record<RepoProvider, string> = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };
const SEG = /^[A-Za-z0-9_.-]{1,100}$/;

/** Parses "https://github.com/o/r", "github.com/o/r.git", "o/r" (GitLab allows nested groups). Other hosts are refused. */
export function parseRepoRef(provider: RepoProvider, input: string): RepoRef | null {
  let s = String(input ?? "").trim().replace(/^git@([^:]+):/, "https://$1/");
  const m = s.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})\/([^\s?#]+)/i);
  if (m) { if (m[1].toLowerCase() !== HOST[provider]) return null; s = m[2]; }
  else if (/[\s:]/.test(s)) { const w = s.match(/\b([\w.-]+\/[\w./-]+)\b/); if (!w) return null; s = w[1]; }
  let parts = s.replace(/\.git$/, "").split("/").filter(Boolean);
  if (provider === "gitlab") { const cut = parts.indexOf("-"); if (cut > 0) parts = parts.slice(0, cut); }
  else parts = parts.slice(0, 2);
  if (parts.length < 2 || !parts.every((p) => SEG.test(p) && p !== "." && p !== "..")) return null;
  const name = parts[parts.length - 1].replace(/\.git$/, "");
  const owner = parts.slice(0, -1).join("/");
  return { owner, name, path: `${owner}/${name}` };
}

const KEY = [/^package\.json$/, /^(requirements\.txt|pyproject\.toml|setup\.py|Pipfile)$/, /^go\.mod$/, /^Cargo\.toml$/, /^(pom\.xml|build\.gradle(\.kts)?)$/, /^composer\.json$/, /^Gemfile$/, /^Dockerfile$/, /^(tsconfig\.json|vite\.config\.\w+|next\.config\.\w+)$/,
  /^(src\/)?(main|index|app|server)\.(ts|tsx|js|jsx|py|go|rs|java|rb|php)$/, /^src\/(lib|main)\.rs$/, /^cmd\/[^/]+\/main\.go$/];
/** Chooses the dependency manifests and entry points worth reading (README is fetched separately). */
export function pickKeyFiles(tree: string[], max: number = REPO_LIMITS.maxFiles): string[] {
  const out: string[] = [];
  for (const re of KEY) for (const p of tree) if (re.test(p) && !out.includes(p) && out.length < max) out.push(p);
  return out;
}
export const findReadme = (tree: string[]) => tree.find((p) => /^readme(\.(md|markdown|rst|txt))?$/i.test(p));

export function errorFor(status: number, what: string, rateLimited = false): RepoError {
  if (status === 429 || rateLimited) return new RepoError("rate_limited", `${what} is rate-limiting anonymous requests right now. Try again in a few minutes.`);
  if (status === 404) return new RepoError("not_found", `That repository wasn't found on ${what}, or it is private.`);
  if (status === 401 || status === 403) return new RepoError("private", `${what} refused access — the repository is private or restricted.`);
  return new RepoError("unavailable", `${what} answered ${status}; the repository couldn't be read.`);
}

/** Model-facing digest: only what was actually retrieved, clearly labelled. */
export function snapshotText(s: RepoSnapshot): string {
  const meta = [`Repository: ${s.fullName} (${s.url})`, s.description && `Description: ${s.description}`, `Default branch: ${s.defaultBranch}`,
    s.language && `Primary language: ${s.language}`, s.stars != null && `Stars: ${s.stars}`, s.license && `License: ${s.license}`].filter(Boolean).join("\n");
  const tree = `File tree (${s.tree.length}${s.treeTruncated ? "+, truncated" : ""} files):\n${s.tree.slice(0, 400).join("\n")}`;
  const files = s.files.map((f) => `--- ${f.path} ---\n${f.text.slice(0, 12_000)}`).join("\n\n");
  return [meta, s.readme ? `--- README ---\n${s.readme.slice(0, 15_000)}` : "README: not found", tree, files].join("\n\n");
}

export function inspectedList(s: RepoSnapshot): string {
  return [s.readme ? "README" : null, ...s.files.map((f) => f.path)].filter(Boolean).join(", ") || "metadata and file tree only";
}
