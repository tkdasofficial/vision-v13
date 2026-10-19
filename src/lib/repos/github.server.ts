// GitHub public repositories via the anonymous REST API (60 requests/hour per IP) + raw.githubusercontent.com.
import { REPO_LIMITS, RepoError, findReadme, parseRepoRef, pickKeyFiles, type RepoSnapshot } from "./common";
import { json, text, type Fetch } from "./http.server";

const W = "GitHub";
const rate = (h: Headers) => h.get("x-ratelimit-remaining") === "0";

export async function fetchGithubRepo(input: string, f?: Fetch): Promise<RepoSnapshot> {
  const ref = parseRepoRef("github", input);
  if (!ref) throw new RepoError("invalid", "That isn't a GitHub repository link (expected github.com/owner/name or owner/name).");
  const api = `https://api.github.com/repos/${ref.path}`;
  const meta = await json(api, W, { f, accept: "application/vnd.github+json", rateHeader: rate });
  if (meta.private) throw new RepoError("private", "That GitHub repository is private.");
  const branch = String(meta.default_branch || "main");
  const t = await json(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`, W, { f, accept: "application/vnd.github+json", rateHeader: rate, allow404: true });
  const tree: string[] = (t?.tree ?? []).filter((x: any) => x.type === "blob").map((x: any) => String(x.path)).slice(0, REPO_LIMITS.maxTree);
  const raw = (p: string) => `https://raw.githubusercontent.com/${ref.path}/${encodeURIComponent(branch)}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const readmePath = findReadme(tree);
  const readme = readmePath ? await text(raw(readmePath), W, { f }) : null;
  const want = pickKeyFiles(tree);
  const got = await Promise.all(want.map(async (p) => ({ path: p, text: await text(raw(p), W, { f }).catch(() => null) })));
  return {
    provider: "github", fullName: String(meta.full_name ?? ref.path), url: String(meta.html_url ?? `https://github.com/${ref.path}`),
    description: String(meta.description ?? ""), defaultBranch: branch, stars: meta.stargazers_count, language: meta.language ?? undefined,
    license: meta.license?.spdx_id ?? undefined, readme: readme ?? undefined, tree, treeTruncated: !!t?.truncated || tree.length >= REPO_LIMITS.maxTree,
    files: got.filter((g): g is { path: string; text: string } => g.text != null), missing: got.filter((g) => g.text == null).map((g) => g.path),
  };
}
