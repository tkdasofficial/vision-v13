import { describe, it, expect } from "vitest";
import { ALL_PLUGINS, FORMAT_PLUGINS, EXTRA_PLUGINS, CODE_FORMAT_IDS, DEFAULT_PLUGIN_IDS, normalizeSelection, pluginFor, planPluginSend } from "@/lib/plugins/manifest";
import { parsePrefs } from "@/lib/settings";
import { parseRepoRef, pickKeyFiles } from "@/lib/repos/common";
import { fetchGithubRepo } from "@/lib/repos/github.server";

describe("plugin inventory", () => {
  it("has exactly 100 plugins: 96 formats + 4 extras", () => {
    expect(ALL_PLUGINS).toHaveLength(100);
    expect(FORMAT_PLUGINS).toHaveLength(96);
    expect(EXTRA_PLUGINS.map((p) => p.name)).toEqual(["Web Search", "GitHub Analyzer", "GitLab Analyzer", "Bitbucket Analyzer"]);
    expect(new Set(ALL_PLUGINS.map((p) => p.id)).size).toBe(100);
  });
  it("excludes the 25 code formats", () => {
    expect(CODE_FORMAT_IDS).toHaveLength(25);
    for (const id of CODE_FORMAT_IDS) expect(ALL_PLUGINS.some((p) => p.id === id)).toBe(false);
    expect(pluginFor("py")).toBeNull();
  });
  it("resolves aliases to one canonical plugin", () => {
    expect(pluginFor("jpg")?.id).toBe("jpeg"); expect(pluginFor("tif")?.id).toBe("tiff");
    expect(pluginFor("mpg")?.id).toBe("mpeg"); expect(pluginFor("yml")?.id).toBe("yaml"); expect(pluginFor("db")?.id).toBe("sqlite");
  });
  it("every plugin has a name and tagline", () => { for (const p of ALL_PLUGINS) { expect(p.name).toBeTruthy(); expect(p.tagline.length).toBeGreaterThan(10); } });
});

describe("plugin selection", () => {
  it("starts with the five defaults", () => { expect(normalizeSelection(undefined)).toEqual(["web-search", "github-analyzer", "pdf", "docx", "xlsx"]); expect(DEFAULT_PLUGIN_IDS).toHaveLength(5); });
  it("drops unknown and duplicate ids and keeps an empty choice", () => {
    expect(normalizeSelection(["png", "png", "py", "nope"])).toEqual(["png"]);
    expect(normalizeSelection([])).toEqual([]);
    expect(parsePrefs({ plugins: ["mp3", "mp3"] }).plugins).toEqual(["mp3"]);
    expect(parsePrefs({}).plugins).toBeNull();
  });
});

describe("plugin send routing", () => {
  it("PNG + JPEG plugin converts without a prompt", () => expect(planPluginSend(["jpeg"], "", [{ name: "photo.png" }])).toEqual({ kind: "files", prompt: "Convert this file to jpeg." }));
  it("MP3 + WAV converts", () => expect(planPluginSend(["wav"], "", [{ name: "a.mp3" }])).toMatchObject({ kind: "files" }));
  it("same format needs no conversion", () => expect(planPluginSend(["png"], "", [{ name: "a.png" }])).toMatchObject({ kind: "reply" }));
  it("unsupported pair is explained", () => expect(planPluginSend(["mp3"], "", [{ name: "a.png" }])).toMatchObject({ kind: "reply" }));
  it("several files ask which one", () => expect(planPluginSend(["pdf"], "", [{ name: "a.docx" }, { name: "b.docx" }])).toMatchObject({ kind: "reply" }));
  it("ZIP bundles attached files or creates then packs", () => {
    expect(planPluginSend(["zip"], "", [{ name: "a.txt" }, { name: "b.csv" }])).toMatchObject({ kind: "files" });
    expect(planPluginSend(["zip"], "three poems", [])).toMatchObject({ kind: "agent" });
  });
  it("creatable format creates from the request; non-creatable explains", () => {
    expect(planPluginSend(["pdf"], "report on solar", [])).toEqual({ kind: "agent", prompt: "report on solar\n\n(Save the result as a .pdf file.)" });
    expect(planPluginSend(["mp3"], "a song", [])).toMatchObject({ kind: "reply" });
  });
  it("web search forces retrieval; repo uses its own tool", () => {
    expect(planPluginSend(["web-search"], "news", [])).toEqual({ kind: "chat", content: "news", webSearch: true });
    expect(planPluginSend(["gitlab-analyzer"], "gitlab.com/a/b", [])).toMatchObject({ kind: "agent", prompt: expect.stringContaining("gitlab_repo") });
  });
});

describe("repository refs", () => {
  it("parses per provider and refuses other hosts", () => {
    expect(parseRepoRef("github", "https://github.com/vercel/next.js/tree/canary")?.path).toBe("vercel/next.js");
    expect(parseRepoRef("gitlab", "https://gitlab.com/group/sub/proj/-/tree/main")?.path).toBe("group/sub/proj");
    expect(parseRepoRef("bitbucket", "bitbucket.org/ws/repo.git")?.path).toBe("ws/repo");
    expect(parseRepoRef("github", "https://gitlab.com/a/b")).toBeNull();
    expect(parseRepoRef("github", "../etc")).toBeNull();
  });
  it("picks manifests", () => expect(pickKeyFiles(["src/a.ts", "package.json", "Dockerfile"])).toEqual(["package.json", "Dockerfile"]));
  it("maps a missing repo to not_found", async () => {
    const f = (async () => new Response("{}", { status: 404 })) as any;
    await expect(fetchGithubRepo("a/b", f)).rejects.toMatchObject({ code: "not_found" });
  });
});
