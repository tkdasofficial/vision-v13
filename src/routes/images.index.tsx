import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirect } from "@/lib/legacy-routes";
// Retired page (picture/video creation is not offered): forwards to /chat.
export const Route = createFileRoute("/images/")({
  beforeLoad: ({ location }) => legacyRedirect(location),
});
