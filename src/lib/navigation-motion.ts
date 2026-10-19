export type NavigationDirection = "forward" | "back" | "left" | "to-left";
export const DRAWER_EVENT = "vision:open-drawer";

/** Gesture surfaces: Chat (drawer ← → Projects), Projects (→ Chat), drawer pages (← drawer). */
export type GestureSurface = "chat" | "projects" | "drawer-page" | "other";
export const DRAWER_PAGES = ["/library", "/integrations", "/settings"] as const;
export function gestureSurface(pathname: string): GestureSurface {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "/chat" || /^\/chat\/[^/]+$/.test(p)) return "chat";
  if (p === "/projects") return "projects";
  if ((DRAWER_PAGES as readonly string[]).includes(p)) return "drawer-page";
  return "other";
}
/** Which navigation a horizontal swipe (dx > 0 = left→right) performs on a surface; null = none. */
export function swipeAction(surface: GestureSurface, dx: number): "drawer" | "projects" | "to-chat" | "to-drawer" | null {
  if (surface === "chat") return dx > 0 ? "drawer" : "projects";
  if (surface === "projects") return dx > 0 ? "to-chat" : null;
  if (surface === "drawer-page") return dx < 0 ? "to-drawer" : null;
  return null;
}
let clickDirection: NavigationDirection | undefined;

/** Consumed synchronously by the shared navigation adapter, never by a later unrelated navigation. */
export function setClickDirection(direction: NavigationDirection) {
  clickDirection = direction;
  queueMicrotask(() => { clickDirection = undefined; });
}
export function consumeClickDirection() {
  const direction = clickDirection;
  clickDirection = undefined;
  return direction;
}
export const PROJECTS_EVENT = "vision:open-projects";
export const DRAWER_SEARCH_EVENT = "vision:open-search";
export const PROJECTS_SEARCH_EVENT = "vision:open-projects-search";
/** Targets only the Projects view under the finger, including its overlay over Chat. */
export function requestProjectsSearch(start: Element | null): boolean {
  const page = start?.closest("[data-projects-search]");
  return page ? !page.dispatchEvent(new CustomEvent(PROJECTS_SEARCH_EVENT, { cancelable: true })) : false;
}
/** Asks the open App Drawer to morph into Search; false when no drawer handled it. */
export function requestSearch(): boolean {
  if (typeof document === "undefined") return false;
  return !document.dispatchEvent(new CustomEvent(DRAWER_SEARCH_EVENT, { cancelable: true }));
}
/** Opens the Projects panel over Chat; false when no Chat screen handled it. */
export function requestProjects(): boolean {
  if (typeof document === "undefined") return false;
  return !document.dispatchEvent(new CustomEvent(PROJECTS_EVENT, { cancelable: true }));
}
/** Closing a drawer page or Projects lands on Chat and replaces the closed page, so no "recent page" can be reopened. */
export function closeTarget(pathname: string, to: string | number): { state: Record<string, boolean>; direction: NavigationDirection } | null {
  const surface = gestureSurface(pathname);
  if (surface === "drawer-page" && (to === -1 || to === "/drawer")) return { state: { __visionOpenDrawer: true }, direction: "to-left" };
  if (surface === "projects" && (to === -1 || to === "/drawer" || to === "/chat")) return { state: {}, direction: "back" };
  if (/^\/projects\/[^/]+$/.test(pathname) && pathname !== "/projects/new" && to === "/projects") return { state: { __visionOpenProjects: true }, direction: "back" };
  return null;
}
export function requestDrawer(): boolean {
  if (typeof document === "undefined") return false;
  return !document.dispatchEvent(new CustomEvent(DRAWER_EVENT, { cancelable: true }));
}

export function drawerProgress(start: number, delta: number, width: number) {
  return Math.min(1, Math.max(0, start + delta / Math.max(width, 1)));
}
export function settleDrawer(progress: number, velocity: number): boolean {
  // Project 180ms ahead; a deliberate reverse flick can interrupt an opening spring.
  return progress + velocity * 0.18 > 0.5;
}
export function springStep(position: number, velocity: number, target: number, seconds: number) {
  // A slow frame advances at most 20ms, so a hiccup slows the slide instead of making it jump.
  let remaining = Math.min(Math.max(seconds, 0), 0.02);
  // Over-damped (damping > 2√320 ≈ 35.8): glides to rest like the Projects page, never bounces.
  // Small sub-steps keep the curve identical at any frame rate.
  while (remaining > 1e-6) {
    const dt = Math.min(remaining, 1 / 240);
    velocity += ((target - position) * 320 - velocity * 40) * dt;
    position = Math.min(1, Math.max(0, position + velocity * dt));
    remaining -= dt;
  }
  return { position, velocity };
}
/** Duration (ms) of a full tap-driven panel slide; shorter distances take proportionally less. */
export const GLIDE_MS = 320;
/** Tap slides run as browser animations: a soft start, then a long gentle stop (no overshoot). */
export const GLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const SLIDE_MS = 400;
export function glideDuration(distance = 1) {
  return SLIDE_MS * Math.max(0.45, Math.min(1, distance));
}
/** Eased 0→1 progress of a tap-driven slide: starts at full speed, stops softly, never overshoots. */
export function glideProgress(elapsedMs: number, distance = 1) {
  const t = Math.min(1, Math.max(0, elapsedMs / (GLIDE_MS * Math.max(0.45, Math.min(1, distance)))));
  return 1 - Math.pow(1 - t, 4);
}
