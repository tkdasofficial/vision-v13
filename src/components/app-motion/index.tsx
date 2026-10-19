import { useEffect } from "react";
import { isMotionReduced } from "@/lib/app-motion";
import { setClickDirection } from "@/lib/navigation-motion";

/** Delegation includes existing icon buttons and controls rendered in portals. */
export function AppMotion() {
  useEffect(() => {
    const animations = new Map<HTMLElement, Animation>();
    const bounce = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>("button, [role='button'], [data-slot='button']");
      if (!control || control.matches(":disabled, [aria-disabled='true'], [data-disabled], [data-motion='off']")) return;
      const label = control.getAttribute("aria-label") ?? control.getAttribute("title") ?? "";
      if (/^(back\b|go back\b|close app drawer\b)/i.test(label)) setClickDirection("back");
      if (isMotionReduced()) return;
      if (typeof control.animate !== "function") return;
      animations.get(control)?.cancel();
      // Independent scale preserves existing transforms and never changes layout.
      const animation = control.animate([
        { scale: "1", offset: 0 }, { scale: "0.95", offset: 0.22 },
        { scale: "1.025", offset: 0.62 }, { scale: "1", offset: 1 },
      ], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      animations.set(control, animation);
      animation.onfinish = () => { if (animations.get(control) === animation) animations.delete(control); };
    };
    const cancelMotion = () => {
      if (!isMotionReduced()) return;
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    preference.addEventListener("change", cancelMotion);
    const observer = new MutationObserver(cancelMotion);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    document.addEventListener("click", bounce, true);
    return () => {
      document.removeEventListener("click", bounce, true);
      preference.removeEventListener("change", cancelMotion);
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, []);
  return null;
}