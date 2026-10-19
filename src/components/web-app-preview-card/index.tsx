import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Code,
  Eye,
  Download,
  Copy,
  Check,
  ChevronRight,
  FileCode,
  Loader2,
  Bot,
  Terminal,
  RotateCcw,
  Pencil,
  CheckCircle2,
  Circle,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { compileProject, type WebAppProject, type GeneratedFile } from "@/lib/web-preview-engine";
import { downloadProjectAsZip } from "@/lib/zip-export";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import FullScreenCodeView from "@/components/chat/full-screen-code-view";
import CodeSource from "@/components/chat/code-source";
import { detectLanguage } from "@/components/chat/highlight";

type Phase = "compiling" | "ready" | "error" | "auto-fixing";
type ConsoleEntry = { level: "log" | "warn" | "error"; message: string; ts: number };
type StepStatus = "done" | "in_progress" | "pending" | "error";
type BuildStep = { label: string; status: StepStatus };
const MAX_AUTO_FIX_ATTEMPTS = 2;

type Props = { project: WebAppProject };

/* ── Helpers ── */

/** Detect actual file types in the project */
function detectProjectInfo(files: GeneratedFile[]) {
  const hasTS = files.some(f => /\.tsx?$/.test(f.path));
  const hasJSX = files.some(f => /\.[jt]sx$/.test(f.path));
  const hasCSS = files.some(f => f.path.endsWith(".css"));
  const hasHTML = files.some(f => f.path.endsWith(".html"));
  const hasJS = files.some(f => /\.js$/.test(f.path));

  const fileTypes: string[] = [];
  if (hasHTML) fileTypes.push("HTML");
  if (hasCSS) fileTypes.push("CSS");
  if (hasTS) fileTypes.push("TypeScript");
  else if (hasJS) fileTypes.push("JavaScript");
  if (hasJSX && !hasTS) fileTypes.push("JSX");

  return { hasTS, hasJSX, hasCSS, hasHTML, hasJS, fileTypes };
}

/** Generate build steps based on actual project content */
function generateBuildSteps(
  framework: string,
  files: GeneratedFile[],
  deps: Record<string, string>,
): BuildStep[] {
  const info = detectProjectInfo(files);
  const depCount = Object.keys(deps).length;
  const steps: BuildStep[] = [];

  // Step 1: Always analyze
  steps.push({ label: `Analyzing ${files.length} ${info.fileTypes.join(", ")} files`, status: "in_progress" });

  // Step 2: Framework-specific
  if (framework === "vanilla-html") {
    steps.push({ label: "Setting up HTML/CSS/JS environment", status: "pending" });
  } else {
    const fwLabel = framework === "react-vite" ? "React + Vite" : "Next.js";
    steps.push({ label: `Initializing ${fwLabel} project`, status: "pending" });
  }

  // Step 3: Dependencies (only if there are any)
  if (depCount > 0) {
    steps.push({ label: `Resolving ${depCount} dependenc${depCount === 1 ? "y" : "ies"}`, status: "pending" });
  }

  // Step 4: Compilation (only for TS/JSX — NOT for plain HTML/CSS/JS)
  if (info.hasTS) {
    steps.push({ label: "Compiling TypeScript & JSX", status: "pending" });
  } else if (info.hasJSX) {
    steps.push({ label: "Compiling JSX components", status: "pending" });
  } else if (framework === "vanilla-html") {
    steps.push({ label: "Inlining scripts & styles", status: "pending" });
  }

  // Step 5: Always build preview
  steps.push({ label: "Building preview", status: "pending" });

  return steps;
}

const frameworkLabel = (fw: string) => {
  if (fw === "react-vite") return "React";
  if (fw === "nextjs-static") return "Next.js";
  return "HTML";
};

const StepIcon = ({ status }: { status: StepStatus }) => {
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />;
  if (status === "in_progress") return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
  if (status === "error") return <AlertCircle className="w-4 h-4 text-destructive shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />;
};

/* ── Main Component ── */

const WebAppPreviewCard = ({ project }: Props) => {
  const [phase, setPhase] = useState<Phase>("compiling");
  const [previewHTML, setPreviewHTML] = useState<string>("");
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>(project.files[0]?.path || "");
  const [isEditing, setIsEditing] = useState(false);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleEntry[]>([]);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [showFullCode, setShowFullCode] = useState(false);
  const [expandedView, setExpandedView] = useState<"code" | "console" | null>(null);
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>(() =>
    generateBuildSteps(project.framework, project.files, project.dependencies)
  );
  const [compileWarnings, setCompileWarnings] = useState<string[]>([]);
  const [autoFixAttempts, setAutoFixAttempts] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const fullIframeRef = useRef<HTMLIFrameElement>(null);
  const compiledOnce = useRef(false);
  const autoFixTriggered = useRef(false);

  const currentFiles = useMemo(() => {
    return project.files.map((f) => ({
      ...f,
      content: editedFiles[f.path] ?? f.content,
    }));
  }, [project.files, editedFiles]);

  // Advance step by index
  const advanceStep = useCallback((stepIdx: number, status: StepStatus) => {
    setBuildSteps(prev => prev.map((s, i) => i === stepIdx ? { ...s, status } : s));
  }, []);

  // Auto-fix: retry compilation, adding a "fixing" step
  const attemptAutoFix = useCallback(async (errorMsg: string) => {
    if (autoFixAttempts >= MAX_AUTO_FIX_ATTEMPTS) return;
    setAutoFixAttempts(prev => prev + 1);
    setPhase("auto-fixing");

    // Add an auto-fix step to the build steps
    setBuildSteps(prev => {
      const steps = prev.map(s => ({ ...s, status: "done" as StepStatus }));
      steps.push({ label: `Auto-fixing: ${errorMsg.slice(0, 60)}...`, status: "in_progress" });
      steps.push({ label: "Rebuilding preview", status: "pending" });
      return steps;
    });

    await delay(400);

    // Retry compilation — the backend now auto-fixes and always returns HTML
    const result = await compileProject(
      currentFiles,
      project.framework,
      project.dependencies,
      project.entryPoint,
    );

    if (result.html) {
      setBuildSteps(prev => prev.map(s => ({ ...s, status: "done" as StepStatus })));
      setPreviewHTML(result.html);
      setPhase("ready");
      if (result.warnings?.length) {
        setCompileWarnings(result.warnings);
      }
    } else {
      setBuildSteps(prev => prev.map((s, i) =>
        i === prev.length - 2 ? { ...s, status: "error" as StepStatus } : s
      ));
      setPhase("error");
    }
  }, [autoFixAttempts, currentFiles, project.framework, project.dependencies, project.entryPoint]);

  // Run backend compilation
  useEffect(() => {
    if (compiledOnce.current) return;
    compiledOnce.current = true;

    const run = async () => {
      const totalSteps = buildSteps.length;

      // Animate through steps before compilation
      for (let i = 0; i < totalSteps - 2; i++) {
        advanceStep(i, "in_progress");
        await delay(250 + Math.random() * 150);
        advanceStep(i, "done");
      }

      // Compilation step (second to last)
      const compileIdx = totalSteps - 2;
      advanceStep(compileIdx, "in_progress");

      const result = await compileProject(
        currentFiles,
        project.framework,
        project.dependencies,
        project.entryPoint,
      );

      if (result.html) {
        advanceStep(compileIdx, "done");

        // Final step: building preview
        const previewIdx = totalSteps - 1;
        advanceStep(previewIdx, "in_progress");
        await delay(200);
        setPreviewHTML(result.html);
        advanceStep(previewIdx, "done");
        setPhase("ready");

        if (result.warnings?.length) {
          setCompileWarnings(result.warnings);
        }
      } else {
        // Auto-fix attempt
        await attemptAutoFix(result.error || "Compilation failed");
      }
    };

    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for runtime errors from iframe and auto-fix
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow && e.source !== fullIframeRef.current?.contentWindow) return;
      if (e.data?.type === "console" && e.data.level === "error" && !autoFixTriggered.current && phase === "ready") {
        const msg = e.data.message || "";
        // Only auto-fix for critical errors (syntax, reference, type errors)
        if (/SyntaxError|ReferenceError|TypeError|Cannot read|is not defined|Unexpected token/.test(msg)) {
          autoFixTriggered.current = true;
          attemptAutoFix(msg);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [phase, attemptAutoFix]);

  // Re-compile with backend after edits
  const handleRecompile = useCallback(async () => {
    setPhase("compiling");
    const newSteps = generateBuildSteps(project.framework, currentFiles, project.dependencies);
    // Mark all but last 2 as done immediately
    setBuildSteps(newSteps.map((s, i) =>
      i < newSteps.length - 2 ? { ...s, status: "done" as StepStatus } :
      i === newSteps.length - 2 ? { ...s, status: "in_progress" as StepStatus } :
      s
    ));

    const result = await compileProject(currentFiles, project.framework, project.dependencies);

    if (result.success && result.html) {
      setBuildSteps(prev => prev.map(s => ({ ...s, status: "done" as StepStatus })));
      setPreviewHTML(result.html);
      setPhase("ready");
    } else {
      setBuildSteps(prev => prev.map((s, i) =>
        i === prev.length - 2 ? { ...s, status: "error" as StepStatus } : s
      ));
      setPhase("error");
    }
  }, [currentFiles, project.framework, project.dependencies]);

  // Console messages from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow && e.source !== fullIframeRef.current?.contentWindow) return;
      if (e.data?.type === "console" && ["log", "warn", "error"].includes(e.data.level) && typeof e.data.message === "string") {
        setConsoleLogs(prev => [
          ...prev.slice(-99),
          { level: e.data.level, message: e.data.message, ts: Date.now() },
        ]);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleDownload = useCallback(async () => {
    try {
      await downloadProjectAsZip(currentFiles, project.framework, project.dependencies, "web-app");
      toast.success("Project downloaded!");
    } catch {
      toast.error("Failed to download project");
    }
  }, [currentFiles, project.framework, project.dependencies]);

  const handleCopyFile = useCallback((filePath: string) => {
    const file = currentFiles.find((f) => f.path === filePath);
    if (file) {
      navigator.clipboard.writeText(file.content);
      setCopiedFile(filePath);
      setTimeout(() => setCopiedFile(null), 2000);
    }
  }, [currentFiles]);

  const handleFileEdit = useCallback((path: string, content: string) => {
    setEditedFiles(prev => ({ ...prev, [path]: content }));
  }, []);

  const handleResetFile = useCallback((path: string) => {
    setEditedFiles(prev => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const hasEdits = Object.keys(editedFiles).length > 0;
  const currentFile = currentFiles.find((f) => f.path === selectedFile);
  const fileTree = useMemo(() => buildFileTree(currentFiles), [currentFiles]);
  const errorCount = consoleLogs.filter((l) => l.level === "error").length;
  const allStepsDone = buildSteps.every((s) => s.status === "done");

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden max-w-2xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" />
            <span className="text-xs sm:text-sm font-medium text-foreground">Agent</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground font-mono">
              {frameworkLabel(project.framework)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {phase === "ready" && hasEdits && (
              <button
                onClick={handleRecompile}
                className="text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors font-medium"
              >
                Recompile
              </button>
            )}
            {phase === "ready" && (
              <button
                onClick={handleDownload}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Download ZIP"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Build steps — ALWAYS shown as primary content */}
        <div className="px-3 sm:px-4 py-3 space-y-1">
          {buildSteps.map((step, i) => (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2.5 py-1.5 px-2 rounded-lg transition-all duration-300",
                step.status === "in_progress" && "bg-primary/5",
              )}
            >
              <StepIcon status={step.status} />
              <span className={cn(
                "text-xs sm:text-[13px] transition-colors",
                step.status === "done" && "text-foreground/70",
                step.status === "in_progress" && "text-foreground font-medium",
                step.status === "pending" && "text-muted-foreground",
                step.status === "error" && "text-destructive",
              )}>
                {step.label}
              </span>
              {step.status === "in_progress" && (
                <span className="text-[10px] text-primary ml-auto animate-pulse">running...</span>
              )}
            </div>
          ))}
        </div>

        {/* Warnings */}
        {compileWarnings.length > 0 && (
          <div className="px-3 sm:px-4 py-2">
            <div className="px-2 py-1.5 rounded-lg bg-accent/50 text-[11px] text-muted-foreground">
              {compileWarnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <span className="text-yellow-500 shrink-0">⚠</span>
                  <span className="break-words">{w}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action bar — shown when ready */}
        {allStepsDone && phase === "ready" && (
          <div className="px-3 sm:px-4 pb-2 pt-1 flex flex-wrap gap-2">
            <button
              onClick={() => setShowFullPreview(true)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                "bg-primary/10 text-primary hover:bg-primary/20 border-primary/20"
              )}
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              onClick={() => setExpandedView(expandedView === "code" ? null : "code")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                expandedView === "code"
                  ? "bg-accent text-foreground border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border-border"
              )}
            >
              <Code className="w-3.5 h-3.5" />
              Code
              <span className="text-[10px] text-muted-foreground">{currentFiles.length}</span>
            </button>
            <button
              onClick={() => setExpandedView(expandedView === "console" ? null : "console")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                expandedView === "console"
                  ? "bg-accent text-foreground border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50 border-border"
              )}
            >
              <Terminal className="w-3.5 h-3.5" />
              Console
              {errorCount > 0 && (
                <span className="text-[10px] px-1 rounded-full bg-destructive/20 text-destructive min-w-[16px] text-center">
                  {errorCount}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Expandable code panel */}
        {expandedView === "code" && (
          <div className="border-t border-border">
            <div className="flex h-[280px] sm:h-[320px]">
              <div className="w-36 sm:w-44 shrink-0 border-r border-border overflow-y-auto bg-muted/20">
                <div className="py-1">
                  {fileTree.map((node) => (
                    <FileTreeNode
                      key={node.path}
                      node={node}
                      selectedFile={selectedFile}
                      onSelect={setSelectedFile}
                      depth={0}
                      editedPaths={editedFiles}
                    />
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col min-w-0">
                {currentFile && (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
                      <span className="text-[11px] text-muted-foreground font-mono truncate">
                        {currentFile.path}
                        {editedFiles[currentFile.path] !== undefined && (
                          <span className="ml-1 text-primary">●</span>
                        )}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="icon" className="size-7" aria-label="Open project code viewer" title="Open code viewer" onClick={() => setShowFullCode(true)}><Code className="size-3" /></Button>
                        {editedFiles[currentFile.path] !== undefined && (
                          <button onClick={() => handleResetFile(currentFile.path)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Reset">
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        <button onClick={() => setIsEditing(!isEditing)} className={cn("p-1 rounded transition-colors", isEditing ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground")} title={isEditing ? "View" : "Edit"}>
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => handleCopyFile(currentFile.path)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                          {copiedFile === currentFile.path ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    </div>
                    {isEditing ? (
                      <textarea
                        value={currentFile.content}
                        onChange={(e) => handleFileEdit(currentFile.path, e.target.value)}
                        className="flex-1 w-full p-3 text-[11px] font-mono leading-relaxed text-foreground bg-background resize-none outline-none border-0"
                        spellCheck={false}
                      />
                    ) : (
                      <div className="min-h-0 flex-1 overflow-auto"><CodeSource code={currentFile.content} language={detectLanguage(currentFile.content)} size={11} /></div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Console panel */}
        {expandedView === "console" && (
          <div className="border-t border-border h-[180px] sm:h-[220px] overflow-y-auto bg-background p-2">
            {consoleLogs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                No console output yet.
              </div>
            ) : (
              <div className="space-y-0.5">
                {consoleLogs.map((entry, i) => (
                  <div key={i} className={cn(
                    "px-2 py-1 rounded text-[11px] font-mono",
                    entry.level === "error" && "bg-destructive/10 text-destructive",
                    entry.level === "warn" && "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
                    entry.level === "log" && "text-muted-foreground"
                  )}>
                    <span className="opacity-50 mr-2">
                      {entry.level === "error" ? "✕" : entry.level === "warn" ? "⚠" : "›"}
                    </span>
                    {entry.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 border-t border-border bg-muted/20">
          <p className="text-[10px] text-muted-foreground">
            {currentFiles.length} file{currentFiles.length !== 1 ? "s" : ""} ·{" "}
            {Object.keys(project.dependencies).length} dep{Object.keys(project.dependencies).length !== 1 ? "s" : ""}
            {hasEdits && " · edited"}
          </p>
          {hasEdits && (
            <button onClick={() => setEditedFiles({})} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Reset all
            </button>
          )}
        </div>
      </div>

      {(showFullPreview || showFullCode) && currentFile && <FullScreenCodeView
        code={currentFile.content}
        language={detectLanguage(currentFile.content)}
        filename={currentFile.path}
        previewHTML={previewHTML || undefined}
        iframeRef={fullIframeRef}
        initialView={showFullPreview ? "preview" : "code"}
        onClose={() => { setShowFullPreview(false); setShowFullCode(false); }}
      />}

    </>
  );
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// File tree
type FileTreeNodeData = { name: string; path: string; isDir: boolean; children: FileTreeNodeData[] };

function buildFileTree(files: GeneratedFile[]): FileTreeNodeData[] {
  const root: FileTreeNodeData[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      let existing = current.find((n) => n.name === part);
      if (!existing) {
        existing = { name: part, path: fullPath, isDir: !isLast, children: [] };
        current.push(existing);
      }
      if (!isLast) current = existing.children;
    }
  }
  const sortNodes = (nodes: FileTreeNodeData[]) => {
    nodes.sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.localeCompare(b.name); });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root);
  return root;
}

function FileTreeNode({ node, selectedFile, onSelect, depth, editedPaths }: {
  node: FileTreeNodeData; selectedFile: string; onSelect: (p: string) => void; depth: number; editedPaths: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  if (node.isDir) {
    return (
      <div>
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-1 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
          <ChevronRight className={cn("w-3 h-3 shrink-0 transition-transform", expanded && "rotate-90")} />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <FileTreeNode key={child.path} node={child} selectedFile={selectedFile} onSelect={onSelect} depth={depth + 1} editedPaths={editedPaths} />
        ))}
      </div>
    );
  }
  return (
    <button onClick={() => onSelect(node.path)} className={cn("w-full flex items-center gap-1 px-2 py-0.5 text-[11px] transition-colors", node.path === selectedFile ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50")} style={{ paddingLeft: `${depth * 12 + 8}px` }}>
      <FileCode className="w-3 h-3 shrink-0" />
      <span className="truncate">{node.name}</span>
      {editedPaths[node.path] !== undefined && <span className="ml-auto text-primary text-[9px]">●</span>}
    </button>
  );
}

export default WebAppPreviewCard;
