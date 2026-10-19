import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router-compat";
import { useRouterState } from "@tanstack/react-router";
import { type AITool } from "@/lib/types";
import { useChatHistory } from "@/context/ChatHistoryContext";
import ChatWorkspace from "@/components/chat-workspace";

const Index = ({ isIncognito = false }: { isIncognito?: boolean }) => {
  // Read from the address: this screen stays mounted across /chat, /chat/<id> and /chat/incognito.
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const draftProject = useRouterState({ select: (st) => {
    const search = st.location.search as Record<string, unknown>;
    return typeof search.project === "string" ? search.project : undefined;
  } });
  const seg = pathname.match(/^\/chat\/([^/]+)\/?$/)?.[1];
  const urlChatId = seg && seg !== "incognito" ? decodeURIComponent(seg) : undefined;
  const base = "/chat";
  const navigate = useNavigate();
  const { getChatById, loadChatMessages } = useChatHistory();

  const [selectedTool, setSelectedTool] = useState<AITool | undefined>(undefined);
  const [chatKey, setChatKey] = useState(0);
  // Starts empty so the effect below loads saved messages when a chat is opened by its address (including reloads).
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);
  const [loadedMessages, setLoadedMessages] = useState<any[] | undefined>(undefined);

  const [loadError, setLoadError] = useState<"not_found" | "unavailable" | null>(null);
  const [opening, setOpening] = useState(false);
  const wanted = useRef<string | undefined>(undefined);
  const justCreated = useRef<string | undefined>(undefined);

  // Reset only when switching empty drafts, never on draft → saved chat navigation.
  useEffect(() => {
    if (!urlChatId) setChatKey((k) => k + 1);
  }, [draftProject]);

  // The address is the source of truth: direct links, refresh, new tabs and Back/Forward all open exactly that chat.
  const openFromUrl = useCallback((id: string) => {
    wanted.current = id;
    setActiveChatId(id);
    setLoadedMessages(undefined);
    setLoadError(null);
    setOpening(true);
    loadChatMessages(id).then((msgs) => {
      if (wanted.current !== id) return; // a newer navigation won
      setLoadedMessages(msgs);
      setChatKey((k) => k + 1);
    }).catch((e: Error) => {
      if (wanted.current !== id) return;
      setLoadError(e.message === "not_found" ? "not_found" : "unavailable");
    }).finally(() => { if (wanted.current === id) setOpening(false); });
  }, [loadChatMessages]);

  useEffect(() => {
    if (urlChatId) {
      // A chat that was just started here already shows its messages; don't reload over it.
      if (urlChatId === justCreated.current) { justCreated.current = undefined; return; }
      if (urlChatId !== wanted.current || loadError) openFromUrl(urlChatId);
    } else if (wanted.current || activeChatId) {
      wanted.current = undefined;
      setActiveChatId(undefined);
      setLoadedMessages(undefined);
      setLoadError(null);
      setChatKey((k) => k + 1);
    }
  }, [urlChatId]);

  const handleNewChat = () => {
    wanted.current = undefined;
    setLoadError(null);
    setSelectedTool(undefined);
    setActiveChatId(undefined);
    setLoadedMessages(undefined);
    setChatKey((k) => k + 1);
    navigate(base);
  };

  const handleIncognitoChat = () => {
    setSelectedTool(undefined);
    setActiveChatId(undefined);
    setLoadedMessages(undefined);
    setChatKey((k) => k + 1);
    navigate(isIncognito ? "/chat" : "/chat/incognito");
  };

  const handleChatCreated = useCallback((id: string) => {
    wanted.current = id;
    justCreated.current = id;
    setActiveChatId(id);
    navigate(`${base}/${id}`, { replace: true });
  }, [navigate, base]);

  const activeChat = activeChatId ? getChatById(activeChatId) : undefined;
  const initialMessages = activeChatId ? loadedMessages ?? activeChat?.messages : undefined;

  return (
    <div className="flex h-[100dvh] bg-background overflow-hidden">
      <main className="flex-1 flex flex-col min-w-0">
        {loadError || opening ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            {opening ? <div role="status" aria-label="Opening chat" className="size-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" /> : <>
              <p className="text-base font-medium text-foreground">{loadError === "not_found" ? "This chat doesn't exist or isn't yours." : "Couldn't open this chat right now."}</p>
              <div className="flex gap-2">
                {loadError === "unavailable" && <Button variant="secondary" className="rounded-full" onClick={() => urlChatId && openFromUrl(urlChatId)}>Try again</Button>}
                <Button className="rounded-full" onClick={handleNewChat}>New chat</Button>
              </div>
            </>}
          </div>
        ) : <ChatWorkspace
          key={`${isIncognito}-${chatKey}`}
          tool={selectedTool}
          isIncognito={isIncognito}
          onIncognitoChat={handleIncognitoChat}
          onMenuClick={() => navigate(`/drawer?returnTo=${encodeURIComponent(pathname)}`)}
          initialMessages={initialMessages && initialMessages.length > 0 ? initialMessages : undefined}
          chatId={activeChatId}
          projectId={!urlChatId && !isIncognito ? draftProject : undefined}
          onChatCreated={handleChatCreated}
        />}
      </main>
    </div>
  );
};

export default Index;
