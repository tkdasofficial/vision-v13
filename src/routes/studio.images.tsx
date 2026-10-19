import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirect } from "@/lib/legacy-routes";
// Old address: forwards to /images.
export const Route = createFileRoute("/studio/images")({
  beforeLoad: ({ location }) => legacyRedirect(location),
});
