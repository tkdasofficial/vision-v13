import { createFileRoute } from "@tanstack/react-router";
import { legacyRedirect } from "@/lib/legacy-routes";

// Old address kept working: forwards to its new path, keeping parameters and query string.
export const Route = createFileRoute("/auth/forget-password")({
  beforeLoad: ({ location }) => legacyRedirect(location),
});
