import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, FileText, MessageSquare, Search as SearchIcon, Sparkles, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { useChatHistory } from "@/context/ChatHistoryContext";
import { supabase } from "@/lib/cloud/client";
import { assetTypes, collectSearchItems, filterSearchItems, type AssetType, type SearchCategory, type SearchItem } from "@/lib/workspace-search";
import { Button } from "@/components/ui/button";
import BottomSearch from "@/components/bottom-search";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const categories = [
  { value: "chats", label: "Recent Chats", icon: MessageSquare },
  { value: "files", label: "Uploaded Files", icon: FileText },
  { value: "generated", label: "Generated Items", icon: Sparkles },
] as const;

export default function WorkspaceSearch({ library = false, topSearch = false, onBack, onNavigate, onScrollChange }: { library?: boolean; topSearch?: boolean; onBack?: () => void; onNavigate?: () => void; onScrollChange?: (scrolled: boolean) => void }) {
  const { user } = useAuth();
  const { history } = useChatHistory();
  const [query, setQuery] = useState("");
  const [librarySearching, setLibrarySearching] = useState(false);
  const [category, setCategory] = useState<SearchCategory | "all">("all");
  const [assetType, setAssetType] = useState<AssetType | "all">("all");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    let cancelled = false;
    async function load() {
      try {
        const [sessions, messages, tasks, stories] = await Promise.all([
          supabase.from("chat_sessions").select("*").eq("user_id", user?.id),
          supabase.from("chat_messages").select("*"),
          supabase.from("background_tasks").select("*").eq("user_id", user?.id),
          supabase.from("story_projects").select("*").eq("user_id", user?.id),
        ]);
        if ([sessions, messages, tasks, stories].some((result) => result.error)) throw new Error("Search unavailable");
        const merged = new Map((messages.data || []).map((message: Record<string, any>) => [message.id, message]));
        // Cached messages retain file details that older saved rows may not contain.
        for (const session of sessions.data || []) {
          let cached: Record<string, any>[] = [];
          try { cached = JSON.parse(localStorage.getItem(`sc_chat_msgs_${session.id}`) || "[]"); } catch { /* Ignore malformed cache. */ }
          if (!Array.isArray(cached)) continue;
          for (const message of cached) {
            if (!message?.id) continue;
            const saved = merged.get(message.id) as Record<string, any> | undefined;
            merged.set(message.id, { ...saved, id: message.id, session_id: session.id, role: message.role, content: message.content, image_url: message.imageUrl || saved?.image_url, created_at: message.timestamp || saved?.created_at || session.created_at, metadata: { ...saved?.metadata, ...message } });
          }
        }
        if (!cancelled) setItems(collectSearchItems(sessions.data || [], [...merged.values()] as Record<string, any>[], tasks.data || [], stories.data || []));
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [user, history]);

  const libraryItems = useMemo(() => items.filter((item) => item.category !== "chats"), [items]);
  const availableTypes = assetTypes.filter((type) => libraryItems.some((item) => (item.assetType || "other") === type.value));
  const results = useMemo(() => filterSearchItems(library ? libraryItems.filter((item) => assetType === "all" || (item.assetType || "other") === assetType) : items, query, category), [items, libraryItems, query, category, library, assetType]);
  const filterClass = topSearch
    ? "drawer-floating drawer-filter h-10 flex-none rounded-full px-4 text-sm font-medium text-foreground"
    : "h-10 flex-none rounded-full border-0 bg-transparent px-5 text-base font-semibold text-muted-foreground data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none";

  return (
    <div className={topSearch ? "relative grid min-h-0 flex-1 grid-cols-1 grid-rows-1" : "flex min-h-0 flex-1 flex-col"}>
        <div className={topSearch ? "drawer-top relative z-10 col-start-1 row-start-1 self-start pb-5 pt-[max(12px,env(safe-area-inset-top))]" : "shrink-0"}>
          {topSearch && library && !librarySearching ? <header className="px-4 sm:px-8"><div className="mx-auto grid h-11 max-w-4xl grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Button variant="floating" size="icon" className="size-11 justify-self-start rounded-full" aria-label="Back to drawer" onClick={onBack}><ArrowLeft /></Button>
            <h1 className="drawer-floating flex h-11 items-center rounded-full px-6 font-display text-lg font-semibold">Library</h1>
            <Button variant="floating" size="icon" className="size-11 justify-self-end rounded-full" aria-label="Search library" title="Search library" onClick={() => setLibrarySearching(true)}><SearchIcon /></Button>
          </div></header> : topSearch && <header className="px-4 sm:px-8">
            <div className="mx-auto flex max-w-4xl items-center gap-3">
              <Button variant="floating" size="icon" className="size-11 shrink-0" aria-label={library ? "Back to Library" : "Back to drawer"} title="Back" onClick={() => { if (library) { setLibrarySearching(false); setQuery(""); } else onBack?.(); }}><ArrowLeft /></Button>
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground" />
                <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={library ? "Search library" : "Search anything"} placeholder={library ? "Search library" : "Search anything"} className="drawer-floating h-11 w-full appearance-none rounded-full pl-12 pr-11 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden" />
                {query && <Button variant="ghost" size="icon" className="absolute right-2 top-1/2 size-8 -translate-y-1/2" aria-label="Clear search" title="Clear search" onClick={() => setQuery("")}><X className="size-4" /></Button>}
              </div>
            </div>
          </header>}
          <div className={`overflow-x-auto px-4 pb-3 sm:px-8 ${topSearch ? "pt-4" : ""}`}>
            <div className="mx-auto max-w-4xl">
            <Tabs value={library ? assetType : category} onValueChange={(value) => library ? setAssetType(value as AssetType | "all") : setCategory(value as SearchCategory | "all")}>
              <TabsList aria-label={library ? "Library file types" : "Search categories"} className="flex h-auto w-max flex-nowrap justify-start gap-2 bg-transparent p-0">
                <TabsTrigger className={filterClass} value="all">All</TabsTrigger>
                {(library ? availableTypes : categories).map((entry) => <TabsTrigger className={filterClass} key={entry.value} value={entry.value}>{entry.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
            </div>
          </div>
        </div>
        <div className={topSearch ? "min-h-0 overflow-y-auto col-start-1 row-start-1 px-4 pb-6 pt-[max(144px,calc(env(safe-area-inset-top)+132px))] sm:px-8" : "min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2 sm:px-8"} onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop > 8)}>
          <div className="mx-auto max-w-3xl">
            {loading ? <p role="status" className="py-12 text-center text-muted-foreground">Loading…</p> : error ? <p role="alert" className="py-12 text-center text-destructive">Search couldn’t load. Please try refreshing.</p> : results.length === 0 ? <div className="py-16 text-center text-muted-foreground"><SearchIcon className="mx-auto mb-4 h-8 w-8" /><p>{query ? "No results found" : "No items yet"}</p></div> : categories.filter((entry) => category === "all" || category === entry.value).map((entry) => {
              const group = results.filter((item) => item.category === entry.value);
              if (!group.length) return null;
              if (library) return <div key={entry.value} className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{group.map((item) => {
                const card = <><p className="line-clamp-2 break-all text-sm font-medium text-foreground">{item.title}</p><entry.icon className="size-5 text-primary" /></>;
                const cls = "drawer-floating flex aspect-square flex-col justify-between rounded-lg p-3 text-left transition-colors hover:bg-accent";
                return item.sessionId ? <Link key={item.id} to="/chat/$chatId" params={{ chatId: item.sessionId }} onClick={onNavigate} className={cls}>{card}</Link> : <div key={item.id} className={cls}>{card}</div>;
              })}</div>;
              return <section key={entry.value} className="mb-8">
                <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{entry.label} <span className="ml-2">{group.length}</span></h2>
                <div className="divide-y divide-border">{group.map((item) => {
                  const content = <><entry.icon className="size-4.5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div>{item.sessionId && <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />}</>;
                  return item.sessionId ? <Link key={item.id} to="/chat/$chatId" params={{ chatId: item.sessionId }} onClick={onNavigate} className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent">{content}</Link> : <div key={item.id} className="flex items-center gap-3 px-3 py-2.5">{content}</div>;
                })}</div>
              </section>;
            })}
          </div>
        </div>
        {!topSearch && <BottomSearch value={query} onChange={setQuery} placeholder={library ? "Search library" : "Search anything"} />}
    </div>
  );
}