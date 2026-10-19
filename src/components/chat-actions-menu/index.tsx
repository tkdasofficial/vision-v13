import { useEffect, useState } from "react";
import { FolderOpen, FolderPlus, MoreVertical, PenSquare, Pin, PinOff, Plus, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/context/AuthContext";
import { useChatHistory } from "@/context/ChatHistoryContext";
import { useNavigate } from "@/lib/router-compat";
import { supabase } from "@/lib/cloud/client";
import { projectIcons } from "@/lib/project-options";

type Project = { id: string; name: string; icon?: string };

export default function ChatActionsMenu({ chatId, onNewChat }: { chatId: string; onNewChat: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getChatById, togglePin, deleteChat, setChatProject } = useChatHistory();
  const chat = getChatById(chatId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    supabase.from("workspace_projects").select("id,name,icon").eq("user_id", user.id).then(({ data }) => setProjects(data || []));
  }, [open, user?.id]);

  const share = async () => {
    const url = `${window.location.origin}/chat/${chatId}`;
    try {
      if (navigator.share) await navigator.share({ title: chat?.title || "Vision chat", url });
      else { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    } catch { /* cancelled */ }
  };

  const moveTo = async (project: Project) => {
    if (await setChatProject(chatId, project.id)) toast.success(`Moved to ${project.name}`);
    else toast.error("Couldn't move the chat. Please try again.");
  };

  const remove = () => {
    if (!window.confirm("Delete this chat?")) return;
    deleteChat(chatId);
    navigate("/chat");
  };

  return <div className="ml-auto flex h-10 items-center rounded-full border border-border bg-secondary">
    <Button variant="ghost" size="icon" className="h-10 w-11 rounded-l-full rounded-r-none hover:bg-accent [&_svg]:size-5" aria-label="New chat" title="New chat" onClick={onNewChat}><PenSquare /></Button>
    <span className="h-5 w-px bg-border" aria-hidden />
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-11 rounded-l-none rounded-r-full hover:bg-accent [&_svg]:size-5" aria-label="Chat options" title="Chat options"><MoreVertical /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 rounded-2xl p-1.5">
        <DropdownMenuItem className="rounded-full" onSelect={() => void share()}><Share2 />Share</DropdownMenuItem>
        <DropdownMenuItem className="rounded-full" onSelect={() => togglePin(chatId)}>{chat?.pinned ? <><PinOff />Unpin</> : <><Pin />Pin</>}</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="rounded-full"><FolderPlus className="mr-2 size-4" />Add to project</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto rounded-2xl p-1.5">
            {projects.map((project) => {
              const Icon = projectIcons.find((e) => e.value === project.icon)?.icon || FolderOpen;
              return <DropdownMenuItem key={project.id} className="rounded-full" disabled={chat?.projectId === project.id} onSelect={() => void moveTo(project)}><Icon /><span className="truncate">{project.name}</span></DropdownMenuItem>;
            })}
            {projects.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem className="rounded-full" onSelect={() => navigate(`/projects/new?chat=${chatId}`)}><Plus />Create new</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="rounded-full text-destructive focus:text-destructive" onSelect={remove}><Trash2 />Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
