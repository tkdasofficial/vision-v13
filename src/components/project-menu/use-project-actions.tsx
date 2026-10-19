import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useChatHistory } from "@/context/ChatHistoryContext";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROJECT_NAME_MAX, clampProjectName } from "@/lib/project-name";
import type { ProjectMenuActions } from "./index";

export type ProjectRow = { id: string; name: string; icon?: string; category?: string; pinned?: boolean | number | null; instructions?: string | null; created_at?: string; updated_at?: string };

/** Menu actions + edit dialogs for one project. `onChange` reloads; `onDeleted` runs after delete. */
export function useProjectActions(onChange: () => void, onDeleted?: () => void) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { history, setChatProject } = useChatHistory();
  const [editing, setEditing] = useState<{ project: ProjectRow; field: "name" | "instructions" } | null>(null);
  const [value, setValue] = useState("");

  const update = async (id: string, patch: Record<string, unknown>) => {
    if (!user) return false;
    const { error } = await supabase.from("workspace_projects").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    if (error) { toast.error(error.message); return false; }
    onChange(); return true;
  };

  const actionsFor = (project: ProjectRow): ProjectMenuActions => ({
    onNewChat: () => navigate(`/chat?project=${encodeURIComponent(project.id)}`),
    onTogglePin: () => void update(project.id, { pinned: !project.pinned }),
    onShare: async () => {
      const url = `${window.location.origin}/projects/${project.id}`;
      try {
        if (navigator.share) await navigator.share({ title: project.name, url });
        else { await navigator.clipboard.writeText(url); toast.success("Project link copied"); }
      } catch { /* cancelled */ }
    },
    onEdit: () => { setEditing({ project, field: "name" }); setValue(project.name); },
    onInstructions: () => { setEditing({ project, field: "instructions" }); setValue(project.instructions || ""); },
    onDelete: async () => {
      if (!user || !window.confirm(`Delete ${project.name}? Its chats will move back to Recent.`)) return;
      const { error } = await supabase.from("workspace_projects").delete().eq("id", project.id).eq("user_id", user.id);
      if (error) { toast.error(error.message); return; }
      await Promise.all(history.filter((c) => c.projectId === project.id).map((c) => setChatProject(c.id, null)));
      onDeleted?.(); onChange();
    },
  });

  const save = async () => {
    if (!editing) return;
    const v = editing.field === "name" ? clampProjectName(value) : value.trim();
    if (editing.field === "name" && !v) return;
    if (await update(editing.project.id, { [editing.field]: v || null })) setEditing(null);
  };

  const dialog = <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
    <DialogContent className="rounded-3xl">
      <DialogHeader><DialogTitle>{editing?.field === "name" ? "Edit project" : "Project instructions"}</DialogTitle></DialogHeader>
      <form id="project-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {editing?.field === "name"
          ? <Input autoFocus aria-label="Project name" value={value} maxLength={PROJECT_NAME_MAX} onChange={(e) => setValue(e.target.value)} className="rounded-full" />
          : <textarea autoFocus aria-label="Project instructions" value={value} maxLength={4000} rows={7} onChange={(e) => setValue(e.target.value)} placeholder="How should Vision respond in this project?" className="w-full rounded-2xl border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
      </form>
      <DialogFooter><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" form="project-edit" disabled={editing?.field === "name" && !value.trim()}>Save</Button></DialogFooter>
    </DialogContent>
  </Dialog>;

  return { actionsFor, dialog };
}
