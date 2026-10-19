import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import Page from "@/pages/chat";
import { Protected } from "@/components/protected";

// One persistent chat screen for /chat, /chat/$chatId and /chat/incognito.
// Child routes only supply the address and page title; keeping the screen here means
// starting a chat (/chat → /chat/<id>) never tears the page down mid-reply.
export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [
    { title: "Vision Chat — Conversations and files" },
    { name: "description", content: "Chat, research, and create documents in your private Vision workspace." },
    { property: "og:title", content: "Vision Chat — Conversations and files" },
    { property: "og:description", content: "Chat, research, and create documents in your private Vision workspace." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: ChatLayout,
});

function ChatLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isIncognito = pathname.replace(/\/$/, "") === "/chat/incognito";
  return (
    <Protected>
      <Page isIncognito={isIncognito} />
      {/* Child routes render nothing visible; a failed child page file retries here without touching the chat. */}
      <div hidden><Outlet /></div>
    </Protected>
  );
}
