import { User } from "lucide-react";
import { useNavigate } from "@/lib/router-compat";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

/** Sidebar profile button: opens the Settings page, which holds every account and app option. */
const ProfileMenu = ({ onNavigate, floating = false }: { onNavigate?: () => void; floating?: boolean }) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  return (
    <Button variant={floating ? "floating" : "secondary"} size="icon" aria-label="Open settings" title="Settings" onClick={() => { navigate("/settings"); onNavigate?.(); }} className="h-12 w-12 shrink-0 overflow-hidden rounded-full">
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" className="h-full w-full rounded-full object-cover" /> : <User className="size-5 text-foreground" />}
    </Button>
  );
};

export default ProfileMenu;
