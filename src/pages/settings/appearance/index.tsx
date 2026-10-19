import { Button } from "@/components/ui/button";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useSettings } from "@/hooks/useSettings";
import { SettingsChoice, SettingsPage, SettingsSection } from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";
import type { Prefs } from "@/lib/settings";

const ACCENTS: { value: Prefs["accent"]; label: string; swatch: string }[] = [
  { value: "mono", label: "Mono", swatch: "bg-foreground" },
  { value: "blue", label: "Blue", swatch: "bg-swatch-blue" },
  { value: "green", label: "Green", swatch: "bg-swatch-green" },
  { value: "orange", label: "Orange", swatch: "bg-swatch-orange" },
  { value: "rose", label: "Rose", swatch: "bg-swatch-rose" },
];

export default function Appearance() {
  const { prefs, update, loading } = useSettings();
  return (
    <SettingsPage title="Appearance" loading={loading}>
      <SettingsSection title="Theme">
        <SettingsChoice label="Theme" value={prefs.theme}
          options={[{ value: "system", label: "System" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]}
          onChange={(v) => update({ theme: v })} />
      </SettingsSection>
      <SettingsSection title="Accent colour" description="Used for main buttons and highlights.">
        <div className="px-1 py-2"><p className="px-4 text-sm font-medium text-foreground">Accent</p><RadioGroupPrimitive.Root value={prefs.accent} onValueChange={(value) => { const accent = ACCENTS.find((a) => a.value === value); if (accent) update({ accent: accent.value }); }} aria-label="Accent colour" className="mt-3 flex flex-wrap gap-2">
          {ACCENTS.map((a) => (
            <RadioGroupPrimitive.Item key={a.value} value={a.value} asChild>
              <Button variant="floating" type="button" aria-label={a.label} title={a.label} size="icon" className="size-11 shrink-0 rounded-full p-2">
                <span className={cn("block size-6 rounded-full ring-offset-2 ring-offset-background", a.swatch, prefs.accent === a.value && "ring-2 ring-foreground")} />
              </Button>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root></div>
      </SettingsSection>
      <SettingsSection title="Text size">
        <SettingsChoice label="Text size" value={prefs.fontSize}
          options={[{ value: "sm", label: "Small" }, { value: "md", label: "Default" }, { value: "lg", label: "Large" }]}
          onChange={(v) => update({ fontSize: v })} />
      </SettingsSection>
    </SettingsPage>
  );
}
