import { useState } from "react";
import { Brain, Check, FolderLock, FolderOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useNavigate, useLocation } from "@/lib/router-compat";
import { useChatHistory } from "@/context/ChatHistoryContext";
import { supabase } from "@/lib/cloud/client";
import { projectCategories, projectIcons } from "@/lib/project-options";
import { PROJECT_NAME_MAX, clampProjectName } from "@/lib/project-name";
import FloatingWorkspacePage from "@/components/floating-workspace-page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ProjectMemory = "default" | "project";
const memoryOptions: { value: ProjectMemory; title: string; body: string; icon: typeof Brain }[] = [
  { value: "default", title: "Default", body: "Uses your saved memories and can learn from chats here.", icon: Brain },
  { value: "project", title: "Project only", body: "Keeps memory inside this project. Other chats can’t see it.", icon: FolderLock },
];

function Section({ step, title, hint, children }: { step: number; title: string; hint?: string; children: React.ReactNode }) {
  return <section className="motion-reveal drawer-floating rounded-[1.75rem] p-3" style={{ animationDelay: `${step * 50}ms` }}>
    <header className="mb-2 flex items-baseline gap-2 px-1">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </header>
    {children}
  </section>;
}

const rowClass = "-mx-3 flex gap-2 overflow-x-auto overscroll-x-contain px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export default function ProjectCreate() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { setChatProject } = useChatHistory();
  const rawChat = (location.search as Record<string, unknown>).chat;
  const chatId = typeof rawChat === "string" && rawChat ? rawChat : null;
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [memory, setMemory] = useState<ProjectMemory>("default");
  const [saving, setSaving] = useState(false);
  const back = chatId ? `/chat/${chatId}` : "/projects";
  const PreviewIcon = projectIcons.find((entry) => entry.value === icon)?.icon ?? FolderOpen;
  const ready = !!name.trim() && !!category;

  const create = async () => {
    if (!user || !ready || saving) return;
    setSaving(true);
    try {
      const id = crypto.randomUUID();
      const result = await supabase.from("workspace_projects").insert({ id, name: clampProjectName(name), icon, category, memory, user_id: user.id });
      if (result.error) { toast.error(result.error.message); return; }
      if (chatId && await setChatProject(chatId, id)) { toast.success(`Moved to ${name.trim()}`); navigate(`/chat/${chatId}`); return; }
      navigate("/projects");
    } catch { toast.error("Project couldn’t be created. Please try again."); }
    finally { setSaving(false); }
  };

  return <FloatingWorkspacePage title="Create project" backTo={back} query="" onQueryChange={() => {}} pullDownSearch footer={
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="motion-reveal mx-auto flex max-w-lg gap-2 rounded-full p-1.5 drawer-floating">
        <Button type="button" variant="ghost" className="h-10 flex-1 rounded-full" disabled={saving} onClick={() => navigate(back)}>Cancel</Button>
        <Button type="submit" form="create-project-form" className="h-10 flex-[2] rounded-full" disabled={!ready || saving}><Plus />{saving ? "Creating…" : "Create project"}</Button>
      </div>
    </div>
  }>
    <form id="create-project-form" className="mx-auto max-w-lg space-y-3" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <div className="motion-reveal drawer-floating flex items-center gap-3 rounded-full p-2 pr-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary/70 text-foreground" key={icon ?? "none"}><PreviewIcon className="size-5 motion-reveal" /></div>
        <div className="min-w-0">
          <p className={cn("truncate text-sm font-semibold", !name.trim() && "text-muted-foreground")}>{name.trim() || "Untitled project"}</p>
          <p className="truncate text-[11px] text-muted-foreground">{category || "No category"} · {memory === "project" ? "Project-only memory" : "Default memory"}</p>
        </div>
      </div>

      <Section step={1} title="Name">
        <div className="relative">
          <input id="project-name" aria-label="Project name" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Brand launch" maxLength={PROJECT_NAME_MAX} required disabled={saving} className="drawer-floating h-11 w-full rounded-full bg-transparent pl-4 pr-14 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground">{name.length}/{PROJECT_NAME_MAX}</span>
        </div>
      </Section>

      <Section step={2} title="Icon" hint="Optional">
        <div className={rowClass}>
          {projectIcons.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-label={label} title={label} aria-pressed={icon === value} onClick={() => setIcon(icon === value ? null : value)} className={cn("motion-control drawer-filter grid size-11 shrink-0 place-items-center rounded-full", icon === value && "border-transparent")} data-state={icon === value ? "active" : undefined}><Icon className="size-[18px]" /></button>)}
        </div>
      </Section>

      <Section step={3} title="Category">
        <div role="radiogroup" aria-label="Category" className={rowClass}>
          {projectCategories.map((entry) => <button key={entry} type="button" role="radio" aria-checked={category === entry} disabled={saving} onClick={() => setCategory(entry)} className="motion-control drawer-filter h-9 shrink-0 whitespace-nowrap rounded-full px-4 text-[13px]" data-state={category === entry ? "active" : undefined}>{entry}</button>)}
        </div>
      </Section>

      <Section step={4} title="Memory">
        <div role="radiogroup" aria-label="Memory" className="grid gap-2">
          {memoryOptions.map(({ value, title, body, icon: Icon }) => <button key={value} type="button" role="radio" aria-checked={memory === value} disabled={saving} onClick={() => setMemory(value)} className={cn("motion-control drawer-filter relative flex gap-2 rounded-3xl p-3 text-left", memory === value && "border-transparent")} data-state={memory === value ? "checked" : undefined}>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0"><span className="block pr-4 text-[13px] font-medium">{title}</span><span className="block text-[11px] leading-snug opacity-70">{body}</span></span>
            {memory === value && <Check className="absolute right-3 top-3 size-4" />}
          </button>)}
        </div>
      </Section>
    </form>
  </FloatingWorkspacePage>;
}
