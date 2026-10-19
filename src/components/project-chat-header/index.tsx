import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/cloud/client";
import { useNavigate } from "@/lib/router-compat";
import { projectHeaderName } from "@/lib/project-name";
import { Button } from "@/components/ui/button";
import ProjectMenu from "@/components/project-menu";
import { useProjectActions, type ProjectRow } from "@/components/project-menu/use-project-actions";

export default function ProjectChatHeader({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setProject(null);
    if (user) void supabase.from("workspace_projects").select("*").eq("id", projectId).eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (!cancelled) setProject(data as ProjectRow | null);
    });
    return () => { cancelled = true; };
  }, [projectId, user?.id, revision]);
  const { actionsFor, dialog } = useProjectActions(() => setRevision((v) => v + 1), () => navigate("/chat"));
  const current = project?.id === projectId ? project : null;
  return <>
    <header className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 bg-transparent px-3 pb-2 pt-[max(12px,env(safe-area-inset-top))] sm:px-4">
      <Button variant="floating" size="icon" className="size-11 rounded-full" aria-label="Back to project" title="Back to project" onClick={() => navigate(`/projects/${projectId}`)}><ArrowLeft /></Button>
      <h1 title={current?.name} className="drawer-floating max-w-full justify-self-center truncate rounded-full px-4 py-2.5 text-sm font-semibold">{projectHeaderName(current?.name || "Project")}</h1>
      {current ? <ProjectMenu name={current.name} pinned={!!current.pinned} actions={actionsFor(current)} /> : <span className="size-11" />}
    </header>
    {dialog}
  </>;
}