import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirect } from "@/lib/legacy-routes";
// Retired page: old image chats open as normal chats.
export const Route = createFileRoute("/images/$imageChatId")({
  beforeLoad: ({ location }) => legacyRedirect(location),
});
