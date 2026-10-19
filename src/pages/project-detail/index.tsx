import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FileText, FolderOpen, MessageSquare, Pin, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useChatHistory } from "@/context/ChatHistoryContext";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import FloatingWorkspacePage from "@/components/floating-workspace-page";
import ChatItemMenu from "@/components/chat-item-menu";
import ChatInput from "@/components/chat-input";
import { useProjectActions, type ProjectRow } from "@/components/project-menu/use-project-actions";
import { Button } from "@/components/ui/button";
import { projectChats } from "@/lib/recent-chats";
import { setPendingProjectPrompt } from "@/lib/pending-project";
import { projectHeaderName } from "@/lib/project-name";
import { cn } from "@/lib/utils";

type Source = { id: string; name: string; mime: string; kind: string; size: number; url: string; created_at: string };
const ACCEPT = ".pdf,.txt,.md,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.zip,.rtf,.odt,image/*";
const MAX = 25 * 1024 * 1024;

function size(n: number) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

export default function ProjectDetail({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { history, renameChat } = useChatHistory();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<"chats" | "sources">("chats");
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<Source[] | null>(null);
  const [uploading, setUploading] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const handleSend = (message: string) => { const text = message.trim(); if (!text) return; setPendingProjectPrompt(projectId, text); navigate(`/chat?project=${encodeURIComponent(projectId)}`); };

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("workspace_projects").select("*").eq("id", projectId).eq("user_id", user.id).maybeSingle();
    if (error) toast.error(error.message);
    if (!data) setMissing(true); else setProject(data as ProjectRow);
  };
  const loadSources = async () => {
    const res = await fetch(`/api/files?project=${encodeURIComponent(projectId)}`, { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(body.error || "Couldn't load sources."); setSources([]); return; }
    setSources(body.files || []);
  };
  useEffect(() => { void load(); }, [user?.id, projectId]);
  useEffect(() => { if (tab === "sources" && sources === null) void loadSources(); }, [tab]);
  const { actionsFor, dialog } = useProjectActions(() => void load(), () => navigate("/projects"));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX) { toast.error(`${file.name} is over 25 MB.`); continue; }
      setUploading((n) => n + 1);
      try {
        const form = new FormData(); form.append("file", file); form.append("project", projectId);
        const res = await fetch("/api/files", { method: "POST", body: form, credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) toast.error(body.error || `Couldn't upload ${file.name}.`);
        else setSources((prev) => [body.file, ...(prev || [])]);
      } finally { setUploading((n) => n - 1); }
    }
    if (fileInput.current) fileInput.current.value = "";
  };
  const removeSource = async (source: Source) => {
    if (!window.confirm(`Delete ${source.name}?`)) return;
    const res = await fetch(`/api/files?id=${encodeURIComponent(source.id)}`, { method: "DELETE", credentials: "include" });
    if (!res.ok) { toast.error("Couldn't delete the source."); return; }
    setSources((prev) => (prev || []).filter((s) => s.id !== source.id));
  };
  const confirmRename = () => { if (editingId && editValue.trim()) renameChat(editingId, editValue.trim()); setEditingId(null); };

  const q = query.trim().toLowerCase();
  const chats = projectChats(history, projectId).filter((c) => c.title.toLowerCase().includes(q));
  const shownSources = (sources || []).filter((s) => s.name.toLowerCase().includes(q));

  if (missing) return <FloatingWorkspacePage title="Project" query={query} onQueryChange={setQuery} backTo="/projects"><div className="py-20 text-center text-muted-foreground"><FolderOpen className="mx-auto mb-4 size-8" /><p>Project not found</p></div></FloatingWorkspacePage>;

  return <FloatingWorkspacePage title={project?.name || "Project"} displayTitle={projectHeaderName(project?.name || "Project")} query={query} onQueryChange={setQuery} backTo="/projects" footer={tab === "chats" ? <ChatInput toolName={project?.name} onSend={handleSend} /> : undefined}>
    <div role="tablist" aria-label="Project sections" className="mb-5 grid grid-cols-2 gap-2">
      {(["chats", "sources"] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-state={tab === t ? "active" : "inactive"} onClick={() => { setTab(t); setQuery(""); }} className="drawer-filter relative z-0 flex h-10 touch-manipulation items-center justify-center gap-2 rounded-full text-sm font-semibold capitalize text-foreground">
        {t === "chats" ? <MessageSquare className="size-4" /> : <FileText className="size-4" />}{t}
      </button>)}
    </div>

    {tab === "chats" ? <div role="tabpanel" className="space-y-1">
      {chats.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{q ? "No chats found" : "No chats in this project yet"}</p> : chats.map((chat) => <div key={chat.id} className="flex items-center gap-1">
        {editingId === chat.id ? <div className="flex min-w-0 flex-1 items-center gap-2">
          <input autoFocus aria-label="Chat title" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") setEditingId(null); }} className="drawer-floating h-11 min-w-0 flex-1 rounded-full px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button variant="ghost" size="icon" aria-label="Save chat title" onClick={confirmRename}><Check /></Button>
          <Button variant="ghost" size="icon" aria-label="Cancel rename" onClick={() => setEditingId(null)}><X /></Button>
        </div> : <>
          <Button variant="floating" className="h-11 min-w-0 flex-1 justify-start gap-3 rounded-full px-4 font-normal" onClick={() => navigate(`/chat/${chat.id}`)}>
            <MessageSquare className="shrink-0 text-muted-foreground" /><span className="truncate">{chat.title}</span>{chat.pinned && <Pin className="ml-auto shrink-0 text-muted-foreground" />}
          </Button>
          <ChatItemMenu chatId={chat.id} title={chat.title} inProject onRename={() => { setEditingId(chat.id); setEditValue(chat.title); }} />
        </>}
      </div>)}
    </div> : <div role="tabpanel" className="space-y-1">
      <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files)} aria-label="Upload sources" />
      <Button variant="floating" className="mb-3 h-11 w-full justify-start rounded-full px-4" disabled={uploading > 0} onClick={() => fileInput.current?.click()}><Upload />{uploading > 0 ? `Uploading ${uploading}…` : "Upload files"}</Button>
      <p className="mb-3 px-4 text-xs text-muted-foreground">PDF, TXT, images, Docs, spreadsheets, CSV, ZIP — up to 25 MB each.</p>
      {sources === null ? <p role="status" className="py-12 text-center text-muted-foreground">Loading…</p> : shownSources.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">{q ? "No sources found" : "No sources yet"}</p> : shownSources.map((s) => <div key={s.id} className="flex items-center gap-1">
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="drawer-floating flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full px-4 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{s.name}</span><span className="block text-xs text-muted-foreground">{s.kind} · {size(s.size)}</span></span>
          <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
        </a>
        <Button variant="ghost" size="icon" className="size-10 shrink-0 rounded-full text-muted-foreground hover:text-destructive" aria-label={`Delete ${s.name}`} title="Delete source" onClick={() => void removeSource(s)}><Trash2 /></Button>
      </div>)}
    </div>}
    {dialog}
  </FloatingWorkspacePage>;
}
