import { useEffect, useRef, type RefObject } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shared −/%/+ zoom buttons used by every full-screen viewer. */
export function ZoomControls({ percent, canOut, canIn, onOut, onIn, onReset, className, buttonClassName }: {
  percent: number; canOut: boolean; canIn: boolean; onOut: () => void; onIn: () => void; onReset: () => void; className?: string; buttonClassName?: string;
}) {
  return <div role="group" aria-label="Zoom" className={cn("hidden items-center gap-0.5 md:flex", className)}>
    <Button variant="ghost" size="icon" className={cn("size-9 rounded-full md:size-8 md:rounded-md", buttonClassName)} onClick={onOut} disabled={!canOut} aria-label="Zoom out" title="Zoom out"><ZoomOut /></Button>
    <Button variant="ghost" className={cn("h-9 min-w-12 rounded-full px-1 font-mono text-xs tabular-nums md:h-8 md:rounded-md", buttonClassName)} onClick={onReset} aria-label="Reset zoom" title="Reset zoom">{percent}%</Button>
    <Button variant="ghost" size="icon" className={cn("size-9 rounded-full md:size-8 md:rounded-md", buttonClassName)} onClick={onIn} disabled={!canIn} aria-label="Zoom in" title="Zoom in"><ZoomIn /></Button>
  </div>;
}

/** Two-finger pinch and Ctrl/⌘ + wheel zoom on an element; `get` / `set` work in the caller's units. */
export function usePinchZoom(ref: RefObject<HTMLElement | null>, get: () => number, set: (value: number) => void, wheelStep: number) {
  const api = useRef({ get, set });
  api.current = { get, set };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Let the browser scroll but never run its own pinch here, so our two-finger handler always gets the gesture.
    el.style.touchAction = "pan-x pan-y";
    let pinch: { d: number; s: number; live?: boolean } | null = null;
    let gesture: number | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const begin = (e: TouchEvent) => { if (e.touches.length >= 2) { const d = dist(e.touches); if (d > 0) pinch = { d, s: api.current.get() }; } };
    const move = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      if (!pinch) begin(e);
      if (!pinch) return;
      if (e.cancelable) e.preventDefault();
      const ratio = dist(e.touches) / pinch.d;
      // Ignore the small finger drift of an accidental second touch; a real pinch moves past 6%.
      if (!pinch.live && Math.abs(ratio - 1) < 0.06) return;
      pinch.live = true;
      api.current.set(pinch.s * ratio);
    };
    const end = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    // iOS Safari reports pinches as gesture events too; use them only when touch tracking isn't active.
    const gStart = (e: Event) => { e.preventDefault(); gesture = api.current.get(); };
    const gChange = (e: Event) => { e.preventDefault(); const scale = (e as Event & { scale?: number }).scale; if (!pinch && gesture != null && scale && Math.abs(scale - 1) >= 0.06) api.current.set(gesture * scale); };
    const gEnd = (e: Event) => { e.preventDefault(); gesture = null; };
    const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); api.current.set(api.current.get() + (e.deltaY < 0 ? wheelStep : -wheelStep)); } };
    el.addEventListener("touchstart", begin, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("gesturestart", gStart, { passive: false } as AddEventListenerOptions);
    el.addEventListener("gesturechange", gChange, { passive: false } as AddEventListenerOptions);
    el.addEventListener("gestureend", gEnd);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("touchstart", begin); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end);
      el.removeEventListener("gesturestart", gStart); el.removeEventListener("gesturechange", gChange); el.removeEventListener("gestureend", gEnd); el.removeEventListener("wheel", wheel);
    };
  });
}
