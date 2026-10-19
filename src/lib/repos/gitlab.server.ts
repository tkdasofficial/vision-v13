// GitLab.com public projects via the anonymous v4 API (project paths may include nested groups).
import { REPO_LIMITS, RepoError, findReadme, parseRepoRef, pickKeyFiles, type RepoSnapshot } from "./common";
import { json, text, type Fetch } from "./http.server";

const W = "GitLab";
const rate = (h: Headers) => h.get("ratelimit-remaining") === "0";

export async function fetchGitlabRepo(input: string, f?: Fetch): Promise<RepoSnapshot> {
  const ref = parseRepoRef("gitlab", input);
  if (!ref) throw new RepoError("invalid", "That isn't a GitLab project link (expected gitlab.com/group/project).");
  const api = `https://gitlab.com/api/v4/projects/${encodeURIComponent(ref.path)}`;
  const meta = await json(api, W, { f, rateHeader: rate });
  if (meta.visibility && meta.visibility !== "public") throw new RepoError("private", "That GitLab project isn't public.");
  const branch = String(meta.default_branch || "main");
  const tree: string[] = []; let truncated = false;
  for (let page = 1; page <= 5; page++) {
    const list = await json(`${api}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${encodeURIComponent(branch)}`, W, { f, rateHeader: rate, allow404: true });
    if (!Array.isArray(list)) break;
    tree.push(...list.filter((x: any) => x.type === "blob").map((x: any) => String(x.path)));
    if (list.length < 100) break;
    if (page === 5) truncated = true;
  }
  const raw = (p: string) => `${api}/repository/files/${encodeURIComponent(p)}/raw?ref=${encodeURIComponent(branch)}`;
  const readmePath = findReadme(tree);
  const readme = readmePath ? await text(raw(readmePath), W, { f }) : null;
  const want = pickKeyFiles(tree);
  const got = await Promise.all(want.map(async (p) => ({ path: p, text: await text(raw(p), W, { f }).catch(() => null) })));
  return {
    provider: "gitlab", fullName: String(meta.path_with_namespace ?? ref.path), url: String(meta.web_url ?? `https://gitlab.com/${ref.path}`),
    description: String(meta.description ?? ""), defaultBranch: branch, stars: meta.star_count, license: meta.license?.name ?? undefined,
    readme: readme ?? undefined, tree: tree.slice(0, REPO_LIMITS.maxTree), treeTruncated: truncated,
    files: got.filter((g): g is { path: string; text: string } => g.text != null), missing: got.filter((g) => g.text == null).map((g) => g.path),
  };
}
