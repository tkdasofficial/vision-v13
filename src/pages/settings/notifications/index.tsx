import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSettings } from "@/hooks/useSettings";
import { SettingsPage, SettingsRow, SettingsSection, SettingsToggle } from "@/components/settings/settings-ui";

export default function Notifications() {
  const { prefs, update, loading } = useSettings();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => { setPerm("Notification" in window ? Notification.permission : "unsupported"); }, []);

  const ask = async () => {
    const p = await Notification.requestPermission(); setPerm(p);
    if (p === "granted") { new Notification("VISION", { body: "Notifications are on.", icon: "/og-icon.png" }); toast.success("Browser notifications enabled"); }
    else if (p === "denied") toast.error("Blocked. Allow notifications in your browser settings.");
  };

  return (
    <SettingsPage title="Notifications" loading={loading}>
      <SettingsSection title="Browser notifications" description="Shown only while VISION is open in a tab you're not looking at.">
        <SettingsRow label="Permission" hint={perm === "granted" ? "Allowed" : perm === "denied" ? "Blocked in browser settings" : perm === "unsupported" ? "Not supported in this browser" : "Not allowed yet"}>
          {perm === "default" && <Button variant="floating" onClick={ask} className="rounded-full px-4 py-2 text-xs font-medium text-foreground">Allow</Button>}
        </SettingsRow>
        <SettingsToggle label="Chat replies" hint="When an AI reply finishes" checked={prefs.notifyReplies} disabled={perm !== "granted"} onChange={(v) => update({ notifyReplies: v })} />
        <SettingsToggle label="Research reports" hint="When a research report is ready" checked={prefs.notifyResearch} disabled={perm !== "granted"} onChange={(v) => update({ notifyResearch: v })} />
      </SettingsSection>
    </SettingsPage>
  );
}
