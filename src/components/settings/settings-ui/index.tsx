import { useId, useState, type ReactNode } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router-compat";
import { cn } from "@/lib/utils";

/** Page frame for every Settings sub-page. */
export function SettingsPage({ title, children, loading }: { title: string; children: ReactNode; loading?: boolean }) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  return (
    <div className="app-drawer relative grid h-[100dvh] grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-settings-canvas text-foreground" data-scrolled={scrolled}>
      <header className="drawer-top pointer-events-none relative z-10 col-start-1 row-start-1 self-start px-4 pb-5 pt-[max(12px,env(safe-area-inset-top))] sm:px-8">
        <div className="mx-auto grid h-11 max-w-xl grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <Button variant="floating" size="icon" className="pointer-events-auto size-11 rounded-full [&_svg]:size-5" aria-label="Back" title="Back" onClick={() => navigate("/settings")}><ArrowLeft /></Button>
          <h1 className="drawer-floating flex h-11 min-w-0 max-w-full items-center justify-center justify-self-center rounded-full px-4 text-center font-display text-lg font-semibold sm:px-6 sm:text-xl"><span className="truncate">{title}</span></h1>
          <span aria-hidden="true" />
        </div>
      </header>
      <div className="col-start-1 row-start-1 min-h-0 overflow-y-auto px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(72px,calc(env(safe-area-inset-top)+60px))] sm:px-8" onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 8)}>
        <div className="max-w-xl mx-auto space-y-4">
          {loading ? <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div> : children}
        </div>
      </div>
    </div>
  );
}

export function SettingsSection({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <section>
      {description && <p className="mb-3 px-5 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {children && <div className="space-y-1.5" aria-label={title}>{children}</div>}
    </section>
  );
}

export function SettingsRow({ label, hint, children, className }: { label: string; hint?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("drawer-floating flex items-center justify-between gap-3 rounded-full px-5 py-3 min-h-12", className)}>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      {children && <div className="flex min-w-0 max-w-[65%] items-center justify-end">{children}</div>}
    </div>
  );
}

export function SettingsToggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const hintId = useId();
  return (
    <SwitchPrimitive.Root asChild checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} aria-describedby={hint ? hintId : undefined}>
      <Button variant="floating" type="button" className="h-auto min-h-14 w-full justify-between gap-4 whitespace-normal rounded-full px-5 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">{label}</span>
          {hint && <span id={hintId} className="mt-0.5 block break-words text-xs font-normal leading-relaxed text-muted-foreground">{hint}</span>}
        </span>
        <span aria-hidden="true" className={cn("inline-flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition-colors motion-reduce:transition-none", checked ? "bg-primary" : "bg-input")}>
          <SwitchPrimitive.Thumb className={cn("block size-4 rounded-full bg-primary-foreground shadow-sm transition-transform motion-reduce:transition-none", checked ? "translate-x-5" : "translate-x-0 bg-foreground")} />
        </span>
      </Button>
    </SwitchPrimitive.Root>
  );
}

/** Segmented single-choice control. */
export function SettingsChoice<T extends string>({ label, hint, value, options, onChange }: {
  label: string; hint?: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="px-1 py-2">
      <p className="px-4 text-sm font-medium text-foreground">{label}</p>
      {hint && <p className="mt-1 px-4 text-xs text-muted-foreground">{hint}</p>}
      <RadioGroupPrimitive.Root value={value} onValueChange={(next) => { const option = options.find((o) => o.value === next); if (option) onChange(option.value); }} aria-label={label} className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <RadioGroupPrimitive.Item key={o.value} value={o.value} asChild>
            <Button variant="floating" type="button" className="drawer-filter h-auto min-h-11 min-w-0 max-w-full whitespace-normal rounded-full px-4 py-2 text-sm">{o.label}</Button>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
    </div>
  );
}

export function ConfirmBox({ text, confirmLabel, onCancel, onConfirm, busy }: { text: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void; busy?: boolean }) {
  return (
    <div className="space-y-3 px-5 py-4">
      <p className="text-sm text-foreground mb-3">{text}</p>
      <div className="flex gap-2">
        <Button variant="floating" type="button" onClick={onCancel} className="h-auto min-h-11 flex-1 whitespace-normal py-2.5 rounded-full">Cancel</Button>
        <Button variant="floating" type="button" onClick={onConfirm} disabled={busy} className="h-auto min-h-11 flex-1 whitespace-normal py-2.5 rounded-full text-destructive">
          {busy ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}
