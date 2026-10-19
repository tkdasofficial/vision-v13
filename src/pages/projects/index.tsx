import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Pin, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import FloatingWorkspacePage from "@/components/floating-workspace-page";
import ProjectMenu from "@/components/project-menu";
import { useProjectActions, type ProjectRow } from "@/components/project-menu/use-project-actions";
import { Button } from "@/components/ui/button";
import { projectIcons } from "@/lib/project-options";
import { sortProjects } from "@/lib/pending-project";

function friendlyDate(value?: string) {
  if (!value) return "";
  const d = new Date(value); if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/** Rendered as the /projects page and as the swipe-in panel over Chat (with onClose). */
export default function Projects({ onClose }: { onClose?: () => void } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const load = async () => {
    if (!user) return;
    const result = await supabase.from("workspace_projects").select("*").eq("user_id", user.id);
    if (result.error) toast.error(result.error.message);
    else setProjects(sortProjects((result.data || []) as ProjectRow[]));
    setLoading(false);
  };
  useEffect(() => { void load(); }, [user?.id]);
  const { actionsFor, dialog } = useProjectActions(() => void load());
  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);

  return <FloatingWorkspacePage title="Projects" query={query} onQueryChange={setQuery} backTo="/chat" onBack={onClose} pullDownSearch
    actions={<Button variant="floating" size="icon" className="size-11 shrink-0 rounded-full [&_svg]:size-5" aria-label="Create project" title="Create project" onClick={() => navigate("/projects/new")}><Plus /></Button>}>
    {loading ? <p role="status" className="py-12 text-center text-muted-foreground">Loading…</p> : shown.length === 0 ? <div className="py-20 text-center text-muted-foreground"><FolderOpen className="mx-auto mb-4 size-8" /><p>{query ? "No projects found" : "No projects yet"}</p></div> : <div className="space-y-1">
      {shown.map((project) => {
        const Icon = projectIcons.find((entry) => entry.value === project.icon)?.icon || FolderOpen;
        return <div key={project.id} className="flex items-center gap-2 py-0.5">
          <Button variant="floating" type="button" onClick={() => navigate(`/projects/${project.id}`)} className="h-auto min-h-12 min-w-0 flex-1 justify-start gap-3 rounded-full px-4 py-1.5 text-left">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium text-foreground">{project.name}</span><span className="block text-xs text-muted-foreground">{friendlyDate(project.updated_at || project.created_at) || project.category || "General"}</span></span>
            {!!project.pinned && <Pin className="ml-auto size-4 shrink-0 text-muted-foreground" aria-label="Pinned" />}
          </Button>
          <ProjectMenu name={project.name} pinned={!!project.pinned} actions={actionsFor(project)} />
        </div>;
      })}
    </div>}
    {dialog}
  </FloatingWorkspacePage>;
}
