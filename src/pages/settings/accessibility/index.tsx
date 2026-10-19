import { useSettings } from "@/hooks/useSettings";
import { SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings/settings-ui";

export default function AccessibilitySettings() {
  const { prefs, update, loading } = useSettings();
  return (
    <SettingsPage title="Accessibility" loading={loading}>
      <SettingsSection title="Display" description="Text size is in Appearance.">
        <SettingsToggle label="Reduce motion" hint="Turn off animations" checked={prefs.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
        <SettingsToggle label="High contrast" hint="Stronger text and outlines" checked={prefs.highContrast} onChange={(v) => update({ highContrast: v })} />
        <SettingsToggle label="Larger tap targets" hint="Bigger buttons and links" checked={prefs.largeTargets} onChange={(v) => update({ largeTargets: v })} />
      </SettingsSection>
    </SettingsPage>
  );
}
