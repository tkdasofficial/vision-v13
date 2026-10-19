import { createFileRoute } from "@tanstack/react-router";
// The chat screen itself lives in the /chat layout (src/routes/chat.tsx); this route only sets the address and title.

export const Route = createFileRoute("/chat/incognito")({
  head: () => ({ meta: [
    { title: "Incognito Chat — Vision" },
    { name: "description", content: "A temporary conversation that is not saved to your Vision history." },
    { property: "og:title", content: "Incognito Chat — Vision" },
    { property: "og:description", content: "Start a temporary, unsaved conversation in Vision." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: IncognitoPage,
});
function IncognitoPage() {
  return null;
}
