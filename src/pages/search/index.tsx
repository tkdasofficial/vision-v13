import DrawerPage from "@/pages/drawer";
import WorkspaceSearch from "@/components/workspace-search";
import { useState } from "react";
import { useNavigate } from "@/lib/router-compat";

export default function Search({ library = false }: { library?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();
  if (!library) return <DrawerPage initialSearch />;
  return <div className="app-drawer flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-settings-canvas text-foreground" data-scrolled={scrolled}><WorkspaceSearch library topSearch onBack={() => navigate("/drawer")} onScrollChange={setScrolled} /></div>;
}
