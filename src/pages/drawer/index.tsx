import AppDrawerView from "@/components/app-drawer";
import { useLocation, useNavigate } from "@/lib/router-compat";
import { safeReturnPath } from "@/lib/route-access";

export default function DrawerPage({ initialSearch = false }: { initialSearch?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const candidate = safeReturnPath(new URLSearchParams(location.searchStr).get("returnTo"));
  const returnTo = candidate.startsWith("/drawer") || candidate.startsWith("/search") ? "/chat" : candidate;
  const activeChatId = returnTo.match(/^\/chat\/([^/?]+)$/)?.[1];
  return <main aria-label="App drawer"><AppDrawerView initialSearch={initialSearch} activeChatId={activeChatId} onClose={() => navigate(returnTo)} onNewChat={() => navigate("/chat")} onSelectChat={(id) => navigate(`/chat/${id}`)} /></main>;
}
