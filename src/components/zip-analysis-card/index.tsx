import { useState, useMemo } from "react";
import {
  FolderOpen, File, FileCode, FileText, FileImage, FileArchive,
  ChevronRight, ChevronDown, Package, HardDrive, Layers, BarChart3,
  Eye, X, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ZipAnalysis, ZipTreeNode, ZipFileEntry } from "@/lib/types";

type Props = { analysis: ZipAnalysis };

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function getFileIcon(ext: string) {
  const codeExts = ["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "cpp", "cs", "php", "swift", "kt", "html", "css", "scss", "json", "xml", "yaml", "yml", "toml", "sh"];
  const imageExts = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"];
  const archiveExts = ["zip", "tar", "gz", "rar", "7z"];
  const docExts = ["md", "txt", "pdf", "doc", "docx", "csv", "log"];

  if (codeExts.includes(ext)) return FileCode;
  if (imageExts.includes(ext)) return FileImage;
  if (archiveExts.includes(ext)) return FileArchive;
  if (docExts.includes(ext)) return FileText;
  return File;
}

/* ── Tree node renderer ── */
const TreeNode = ({ node, depth = 0, onPreview }: { node: ZipTreeNode; depth?: number; onPreview: (path: string) => void }) => {
  const [open, setOpen] = useState(depth < 2);
  const Icon = node.isDirectory ? FolderOpen : getFileIcon(node.name.split(".").pop()?.toLowerCase() || "");

  return (
    <div>
      <button
        onClick={() => node.isDirectory ? setOpen(!open) : onPreview(node.path)}
        className={cn(
          "flex items-center gap-1.5 w-full text-left py-0.5 px-1 rounded hover:bg-accent/50 transition-colors text-[12px]",
          !node.isDirectory && "cursor-pointer"
        )}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {node.isDirectory && (
          open ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        {!node.isDirectory && <span className="w-3 shrink-0" />}
        <Icon className={cn("w-3.5 h-3.5 shrink-0", node.isDirectory ? "text-primary" : "text-muted-foreground")} />
        <span className="truncate text-foreground">{node.name}</span>
        {!node.isDirectory && node.size > 0 && (
          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{formatSize(node.size)}</span>
        )}
      </button>
      {node.isDirectory && open && node.children.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onPreview={onPreview} />
      ))}
    </div>
  );
};

/* ── File type bar chart ── */
const TypeChart = ({ fileTypes }: { fileTypes: Record<string, number> }) => {
  const sorted = Object.entries(fileTypes).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted[0]?.[1] || 1;

  return (
    <div className="space-y-1">
      {sorted.map(([ext, count]) => (
        <div key={ext} className="flex items-center gap-2 text-[11px]">
          <span className="w-12 text-right text-muted-foreground font-mono">.{ext}</span>
          <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
            <div
              className="h-full bg-primary/60 rounded-sm transition-all"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 text-muted-foreground text-right">{count}</span>
        </div>
      ))}
    </div>
  );
};

/* ── File preview modal ── */
const FilePreview = ({ entry, onClose }: { entry: ZipFileEntry | null; onClose: () => void }) => {
  if (!entry) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[80vh] bg-card border border-border rounded-xl shadow-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-mono text-foreground">{entry.path}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        <pre className="p-4 overflow-auto max-h-[65vh] text-[12px] font-mono text-foreground leading-relaxed">
          {entry.content || "(Binary file — no preview available)"}
        </pre>
      </div>
    </div>
  );
};

/* ── Main card ── */
const ZipAnalysisCard = ({ analysis }: Props) => {
  const [activeTab, setActiveTab] = useState<"tree" | "types" | "files">("tree");
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const previewEntry = useMemo(
    () => analysis.entries.find((e) => e.path === previewPath) || null,
    [analysis.entries, previewPath]
  );

  const filteredEntries = useMemo(() => {
    if (!search) return analysis.entries.filter((e) => !e.isDirectory);
    const q = search.toLowerCase();
    return analysis.entries.filter((e) => !e.isDirectory && e.path.toLowerCase().includes(q));
  }, [analysis.entries, search]);

  const tabs = [
    { id: "tree" as const, label: "Structure", icon: Layers },
    { id: "types" as const, label: "File Types", icon: BarChart3 },
    { id: "files" as const, label: "All Files", icon: File },
  ];

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden w-full">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">{analysis.fileName}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat icon={File} label="Files" value={analysis.totalFiles.toString()} />
          <Stat icon={FolderOpen} label="Folders" value={analysis.totalDirectories.toString()} />
          <Stat icon={HardDrive} label="Total Size" value={formatSize(analysis.totalSize)} />
          <Stat icon={Package} label="Compressed" value={`${analysis.compressionRatio}% saved`} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors border-b-2",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-[50vh] overflow-y-auto">
        {activeTab === "tree" && (
          <div className="p-2">
            {analysis.tree.map((node) => (
              <TreeNode key={node.path} node={node} onPreview={setPreviewPath} />
            ))}
          </div>
        )}

        {activeTab === "types" && (
          <div className="p-4">
            <TypeChart fileTypes={analysis.fileTypes} />
          </div>
        )}

        {activeTab === "files" && (
          <div>
            <div className="px-3 py-2 border-b border-border">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search files..."
                  className="w-full pl-8 pr-3 py-1.5 text-[12px] bg-muted rounded-md border border-border text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
              </div>
            </div>
            <div className="divide-y divide-border">
              {filteredEntries.slice(0, 100).map((entry) => {
                const Icon = getFileIcon(entry.extension);
                return (
                  <button
                    key={entry.path}
                    onClick={() => entry.content && setPreviewPath(entry.path)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-accent/50 transition-colors"
                  >
                    <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[12px] text-foreground truncate flex-1">{entry.path}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{formatSize(entry.size)}</span>
                    {entry.content && <Eye className="w-3 h-3 text-muted-foreground shrink-0" />}
                  </button>
                );
              })}
              {filteredEntries.length > 100 && (
                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                  +{filteredEntries.length - 100} more files...
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* File preview modal */}
      <FilePreview entry={previewEntry} onClose={() => setPreviewPath(null)} />
    </div>
  );
};

const Stat = ({ icon: Icon, label, value }: { icon: any; label: string; value: string }) => (
  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/50">
    <Icon className="w-3 h-3 text-muted-foreground" />
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-[12px] font-medium text-foreground">{value}</p>
    </div>
  </div>
);

export default ZipAnalysisCard;
