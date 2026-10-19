// Bitbucket Cloud public repositories via the anonymous 2.0 API. The /src listing is per directory,
// so the tree is walked breadth-first with a request budget.
import { REPO_LIMITS, RepoError, findReadme, parseRepoRef, pickKeyFiles, type RepoSnapshot } from "./common";
import { json, text, type Fetch } from "./http.server";

const W = "Bitbucket";
const MAX_LISTINGS = 12;

export async function fetchBitbucketRepo(input: string, f?: Fetch): Promise<RepoSnapshot> {
  const ref = parseRepoRef("bitbucket", input);
  if (!ref) throw new RepoError("invalid", "That isn't a Bitbucket repository link (expected bitbucket.org/workspace/repo).");
  const api = `https://api.bitbucket.org/2.0/repositories/${ref.path}`;
  const meta = await json(api, W, { f });
  if (meta.is_private) throw new RepoError("private", "That Bitbucket repository is private.");
  const branch = String(meta.mainbranch?.name || "main");
  const src = (p: string) => `${api}/src/${encodeURIComponent(branch)}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const tree: string[] = []; const dirs = [""]; let listings = 0; let truncated = false;
  while (dirs.length && listings < MAX_LISTINGS && tree.length < REPO_LIMITS.maxTree) {
    const d = dirs.shift()!; listings++;
    const page = await json(`${src(d)}${d ? "/" : ""}?pagelen=100`, W, { f, allow404: true });
    for (const v of page?.values ?? []) {
      if (v.type === "commit_file") tree.push(String(v.path));
      else if (v.type === "commit_directory" && !/(^|\/)(node_modules|vendor|\.git|dist|build)$/.test(v.path)) dirs.push(String(v.path));
    }
    if (page?.next) truncated = true;
  }
  if (dirs.length) truncated = true;
  const readmePath = findReadme(tree);
  const readme = readmePath ? await text(src(readmePath), W, { f }) : null;
  const want = pickKeyFiles(tree);
  const got = await Promise.all(want.map(async (p) => ({ path: p, text: await text(src(p), W, { f }).catch(() => null) })));
  return {
    provider: "bitbucket", fullName: String(meta.full_name ?? ref.path), url: String(meta.links?.html?.href ?? `https://bitbucket.org/${ref.path}`),
    description: String(meta.description ?? ""), defaultBranch: branch, language: meta.language || undefined,
    readme: readme ?? undefined, tree, treeTruncated: truncated,
    files: got.filter((g): g is { path: string; text: string } => g.text != null), missing: got.filter((g) => g.text == null).map((g) => g.path),
  };
}
