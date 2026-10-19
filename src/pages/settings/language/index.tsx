import { useSettings } from "@/hooks/useSettings";
import { SettingsChoice, SettingsPage, SettingsSection } from "@/components/settings/settings-ui";

export default function Language() {
  const { language, updateLanguage, loading } = useSettings();
  return (
    <SettingsPage title="Language" loading={loading}>
      <SettingsSection title="Interface language" description="VISION is currently available in English only. The AI can still reply in any language you write in.">
        <SettingsChoice label="Language" value={language === "English" ? "en" : language} options={[{ value: "en", label: "English" }]} onChange={updateLanguage} />
      </SettingsSection>
    </SettingsPage>
  );
}
