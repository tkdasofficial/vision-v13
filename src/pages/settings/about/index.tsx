import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { SettingsPage, SettingsRow, SettingsSection } from "@/components/settings/settings-ui";

const links = [
  { to: "/guide", label: "App Guide" },
  { to: "/support", label: "Help & Support" },
  { to: "/legal/terms", label: "Terms of Service" },
  { to: "/legal/privacy", label: "Privacy Policy" },
  { to: "/help/faq", label: "FAQ" },
] as const;

export default function About() {
  return (
    <SettingsPage title="About VISION">
      <SettingsSection title="VISION" description="Your all-in-one AI workspace.">
        <SettingsRow label="Version" hint="1.0.0" />
      </SettingsSection>
      <SettingsSection title="Help & legal">
        {links.map((l) => (
          <Button key={l.to} variant="floating" asChild className="h-auto min-h-12 w-full justify-between whitespace-normal rounded-full px-5 py-3 text-sm"><Link to={l.to}>
            {l.label}<ChevronRight className="w-4 h-4 text-muted-foreground" />
          </Link></Button>
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}
