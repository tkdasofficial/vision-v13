export type SearchCategory = "chats" | "files" | "generated";
export type AssetType = "image" | "video" | "pdf" | "audio" | "document" | "archive" | "app" | "other";
export const assetTypes: { value: AssetType; label: string }[] = [
  { value: "image", label: "Images" }, { value: "video", label: "Videos" },
  { value: "pdf", label: "PDF" }, { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" }, { value: "archive", label: "Archives" },
  { value: "app", label: "Apps" }, { value: "other", label: "Other" },
];

export function inferAssetType(file: { fileName?: string; name?: string; mimeType?: string; type?: string; format?: string } = {}, fallback: AssetType = "other"): AssetType {
  const mime = (file.mimeType || file.type || "").toLowerCase();
  const ext = (file.fileName || file.name || "").split(".").pop()?.toLowerCase() || file.format?.toLowerCase();
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "heic"].includes(ext || "")) return "image";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(ext || "")) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext || "")) return "audio";
  if (mime.includes("zip") || ["zip", "rar", "7z", "tar", "gz"].includes(ext || "")) return "archive";
  if (mime.startsWith("text/") || /document|spreadsheet|presentation/.test(mime) || ["txt", "md", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx", "rtf", "html", "json"].includes(ext || "")) return "document";
  return fallback;
}
export type SearchItem = {
  id: string;
  category: SearchCategory;
  title: string;
  detail: string;
  sessionId?: string;
  date: string;
  assetType?: AssetType;
};

type Row = Record<string, any>;

export function collectSearchItems(sessions: Row[], messages: Row[], tasks: Row[], stories: Row[]): SearchItem[] {
  const items: SearchItem[] = sessions.filter((session) => !session.project_id).map((session) => ({
    id: session.id, category: "chats", title: session.title || "Untitled chat",
    detail: session.preview || "", sessionId: session.id, date: session.created_at,
  }));
  const sessionIds = new Set(sessions.map((session) => session.id));
  for (const message of messages) {
    if (!sessionIds.has(message.session_id)) continue;
    const meta = message.metadata || {};
    const category = message.role === "user" ? "files" : "generated";
    const attachment = meta.generatedFile || meta.zipAnalysis || meta.convertFile || meta.attachment;
    if (message.image_url || attachment || meta.webApp || meta.videos?.length || meta.ttsScript || meta.videoGeneration) {
      items.push({
        id: `message-${message.id}`, category,
        assetType: inferAssetType(attachment || {}, meta.webApp ? "app" : message.image_url ? "image" : meta.videos?.length || meta.videoGeneration ? "video" : meta.ttsScript ? "audio" : "other"),
        title: attachment?.fileName || attachment?.name || (meta.webApp ? "Generated app" : message.image_url ? (category === "files" ? "Uploaded image" : "Generated image") : meta.videos?.length || meta.videoGeneration ? "Video" : "Audio"),
        detail: message.content || "", sessionId: message.session_id, date: message.created_at,
      });
    }
  }
  for (const task of tasks) {
    if (task.status !== "completed" || !task.result || task.result.type === "chat") continue;
    items.push({ id: `task-${task.id}`, category: "generated", assetType: inferAssetType(task.result, task.result.type === "image" ? "image" : task.result.type === "video" ? "video" : task.result.type === "audio" || task.task_type === "tts" ? "audio" : task.result.type === "webapp" ? "app" : "other"), title: task.result.fileName || task.input?.topic || task.input?.prompt || `Generated ${task.task_type}`, detail: task.result.explanation || task.task_type, sessionId: sessionIds.has(task.session_id) ? task.session_id : undefined, date: task.created_at });
  }
  for (const story of stories) {
    items.push({ id: `story-${story.id}`, category: "generated", title: story.title || "Story project", detail: story.status || "", sessionId: sessionIds.has(story.session_id) ? story.session_id : undefined, date: story.created_at });
  }
  return items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

export function filterSearchItems(items: SearchItem[], query: string, category: SearchCategory | "all") {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((item) => (category === "all" || item.category === category) && words.every((word) => `${item.title} ${item.detail}`.toLocaleLowerCase().includes(word)));
}