import JSZip from "jszip";
import type { ZipAnalysis, ZipFileEntry, ZipTreeNode } from "./types";

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "json", "xml", "csv", "yaml", "yml", "toml",
  "js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java",
  "c", "cpp", "h", "hpp", "cs", "swift", "kt", "php",
  "html", "css", "scss", "less", "sass", "svg",
  "sh", "bash", "zsh", "bat", "ps1",
  "env", "gitignore", "dockerignore", "editorconfig",
  "lock", "log", "ini", "cfg", "conf",
]);

const MAX_PREVIEW_SIZE = 8000; // max chars to preview per file

function getExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function isTextFile(name: string): boolean {
  const ext = getExtension(name);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Files without extension that are likely text
  const baseName = name.split("/").pop()?.toLowerCase() || "";
  return ["makefile", "dockerfile", "readme", "license", "changelog", "contributing"].includes(baseName);
}

function buildTree(entries: ZipFileEntry[]): ZipTreeNode[] {
  const root: ZipTreeNode = { name: "", path: "", isDirectory: true, size: 0, children: [] };

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join("/");
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.name === parts[i]);

      if (!child) {
        child = {
          name: parts[i],
          path: partPath,
          isDirectory: isLast ? entry.isDirectory : true,
          size: isLast ? entry.size : 0,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetically
  const sortNodes = (nodes: ZipTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root.children);

  return root.children;
}

export async function analyzeZip(file: File): Promise<ZipAnalysis> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  const entries: ZipFileEntry[] = [];
  const fileTypes: Record<string, number> = {};
  let totalSize = 0;
  let totalFiles = 0;
  let totalDirectories = 0;

  const filePromises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    const ext = getExtension(relativePath) || (zipEntry.dir ? "folder" : "unknown");
    const entry: ZipFileEntry = {
      path: relativePath,
      name: relativePath.split("/").filter(Boolean).pop() || relativePath,
      size: 0,
      compressedSize: 0,
      isDirectory: zipEntry.dir,
      extension: ext,
    };

    if (zipEntry.dir) {
      totalDirectories++;
      entries.push(entry);
      return;
    }

    totalFiles++;
    fileTypes[ext] = (fileTypes[ext] || 0) + 1;

    const promise = zipEntry.async("uint8array").then(async (data) => {
      entry.size = data.length;
      entry.compressedSize = data.length; // JSZip doesn't expose compressed size easily
      totalSize += data.length;

      // Read text content for small text files
      if (isTextFile(relativePath) && data.length < MAX_PREVIEW_SIZE) {
        try {
          entry.content = new TextDecoder("utf-8").decode(data);
        } catch {
          // binary file
        }
      }
    });

    entries.push(entry);
    filePromises.push(promise);
  });

  await Promise.all(filePromises);

  // Sort by size descending for largest files
  const sortedBySize = [...entries]
    .filter((e) => !e.isDirectory)
    .sort((a, b) => b.size - a.size);

  const tree = buildTree(entries);

  return {
    fileName: file.name,
    totalFiles,
    totalDirectories,
    totalSize,
    compressedSize: file.size,
    compressionRatio: totalSize > 0 ? Math.round((1 - file.size / totalSize) * 100) : 0,
    fileTypes,
    largestFiles: sortedBySize.slice(0, 10),
    tree,
    entries,
  };
}
