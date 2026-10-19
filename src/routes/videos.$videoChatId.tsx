import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirect } from "@/lib/legacy-routes";
// Retired page: old video chats open as normal chats.
export const Route = createFileRoute("/videos/$videoChatId")({
  beforeLoad: ({ location }) => legacyRedirect(location),
});
