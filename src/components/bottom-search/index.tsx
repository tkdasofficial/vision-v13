import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Pill search field pinned to the bottom of a page, with an optional round action beside it. */
export default function BottomSearch({ value, onChange, placeholder, label, action }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; action?: ReactNode }) {
  return (
    <div className="drawer-bottom relative shrink-0 px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder}
            className="drawer-floating h-12 w-full rounded-full pl-12 pr-11 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {value && <Button variant="ghost" size="icon" type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2 top-1/2 size-8 -translate-y-1/2"><X className="size-4" /></Button>}
        </div>
        {action}
      </div>
    </div>
  );
}
