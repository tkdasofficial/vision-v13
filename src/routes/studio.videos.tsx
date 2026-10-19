import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirect } from "@/lib/legacy-routes";
// Old address: forwards to /videos.
export const Route = createFileRoute("/studio/videos")({
  beforeLoad: ({ location }) => legacyRedirect(location),
});
