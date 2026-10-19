import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { SettingsChoice, SettingsPage, SettingsSection, SettingsToggle } from "@/components/settings/settings-ui";
import { CHAT_MODES } from "@/lib/ai/modes";
import { MAX_INSTRUCTIONS } from "@/lib/settings";

export default function AiPreferences() {
  const { prefs, update, loading, saving } = useSettings();
  const [draft, setDraft] = useState(prefs.customInstructions);
  useEffect(() => setDraft(prefs.customInstructions), [prefs.customInstructions]);
  const dirty = draft !== prefs.customInstructions;
  return (
    <SettingsPage title="AI Preferences" loading={loading}>
      <SettingsSection title="Default mode" description="The mode selected when you start a new chat. VISION never changes your chosen mode by itself.">
        <SettingsChoice label="Start new chats in" value={prefs.defaultMode}
          options={CHAT_MODES.map((m) => ({ value: m.id, label: m.label }))} onChange={(v) => update({ defaultMode: v })} />
      </SettingsSection>
      <SettingsSection title="Responses">
        <SettingsChoice label="Length" value={prefs.responseLength}
          options={[{ value: "concise", label: "Concise" }, { value: "balanced", label: "Balanced" }, { value: "detailed", label: "Detailed" }]}
          onChange={(v) => update({ responseLength: v })} />
        <SettingsChoice label="Tone" value={prefs.tone}
          options={[{ value: "neutral", label: "Neutral" }, { value: "friendly", label: "Friendly" }, { value: "formal", label: "Formal" }]}
          onChange={(v) => update({ tone: v })} />
      </SettingsSection>
      <SettingsSection title="Custom instructions" description="Tell VISION about yourself or how to answer. Applied to every chat.">
        <div className="space-y-3 px-1 py-2">
          <textarea value={draft} maxLength={MAX_INSTRUCTIONS} onChange={(e) => setDraft(e.target.value)} rows={5}
            aria-label="Custom instructions" placeholder="e.g. I'm a student. Explain with simple examples."
            className="drawer-floating rounded-3xl px-5 py-4 w-full resize-none text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground" />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{draft.length}/{MAX_INSTRUCTIONS}</span>
            <div className="flex gap-2">
              <Button variant="floating" disabled={!dirty} onClick={() => setDraft(prefs.customInstructions)} className="drawer-floating rounded-full px-4 py-2 text-sm disabled:opacity-40">Cancel</Button>
              <Button variant="floating" disabled={!dirty || saving} onClick={() => update({ customInstructions: draft })} className="rounded-full px-4 py-2 text-sm font-medium text-foreground disabled:opacity-40">Save</Button>
            </div>
          </div>
        </div>
      </SettingsSection>
      <SettingsSection title="Web search" description="Used by Research mode. Sources: Wikipedia and DuckDuckGo quick answers. Full web search isn't connected yet.">
        <SettingsChoice label="Search the web" value={prefs.webSearch}
          options={[{ value: "auto", label: "Research only" }, { value: "always", label: "Always" }, { value: "off", label: "Off" }]}
          onChange={(v) => update({ webSearch: v })} />
      </SettingsSection>
      <SettingsSection title="Coding">
        <SettingsToggle label="Comment code" hint="Add helpful comments to generated code" checked={prefs.codeComments} onChange={(v) => update({ codeComments: v })} />
        <SettingsChoice label="Explanations" value={prefs.codeExplain}
          options={[{ value: "brief", label: "Brief" }, { value: "full", label: "Step by step" }]} onChange={(v) => update({ codeExplain: v })} />
      </SettingsSection>
    </SettingsPage>
  );
}
