import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "@tanstack/react-router";
import { useAuth } from "@/context/AuthContext";
import { useLocation, useNavigate } from "@/lib/router-compat";
import AppDrawerView from "@/components/app-drawer";
import Projects from "@/pages/projects";
import { isMotionReduced } from "@/lib/app-motion";
import { classifyRoute, safeReturnPath } from "@/lib/route-access";
import { DRAWER_EVENT, GLIDE_EASE, PROJECTS_EVENT, drawerProgress, glideDuration, gestureSurface, requestProjectsSearch, requestSearch, settleDrawer, springStep, swipeAction } from "@/lib/navigation-motion";

type Drag = { id: number; x: number; y: number; lastX: number; time: number; start: number; velocity: number; kind: "drawer" | "back" | "pending" | "projects" | "to-chat" | "to-drawer"; active: boolean; header?: boolean };

// Memoized so starting a swipe (which re-renders this component) never re-renders the chat list.
const DrawerView = memo(AppDrawerView);

function scrollsX(start: Element | null, dx: number) {
  for (let node = start; node && node !== document.body; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 2 || !/auto|scroll/.test(getComputedStyle(node).overflowX)) continue;
    if (dx > 0 ? node.scrollLeft > 1 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1) return true;
  }
  return false;
}
/** A pull-down only counts when it starts on the page header (or the top strip where it floats). */
const fromHeader = (target: Element, y: number) => !!target.closest("header, .drawer-top, [data-gesture-header]") || y <= 88;
/** True when the touched content can still scroll up, so a pull-down there means "scroll", not "search". */
function scrollsUp(start: Element | null) {
  for (let node = start; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollTop > 1) return true;
  }
  return false;
}
type TouchPoint = { pointerType: string; isPrimary: boolean; pointerId: number; clientX: number; clientY: number; target: EventTarget | null; type: string; preventDefault: () => void };
/** Touch events keep arriving even where a scroll area would cancel pointer events, so swipes work anywhere. */
function fromTouch(event: TouchEvent, touch: Touch, cancel = false): TouchPoint {
  return { pointerType: "touch", isPrimary: event.touches.length <= 1, pointerId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY, target: event.target, type: cancel ? "pointercancel" : event.type, preventDefault: () => { if (event.cancelable) event.preventDefault(); } };
}

/** Only the overlay moves; the routed workspace and its live stream stay mounted. */
export default function NavigationGestures() {
  const { user } = useAuth();
  const router = useRouter();
  const location = useLocation();
  const navigate = useNavigate();
  const enabled = Boolean(user) && classifyRoute(location.pathname) === "protected" && !location.pathname.startsWith("/admin");
  const directDrawer = location.pathname === "/drawer";
  const [visible, setVisible] = useState(false);
  const [drawerSearch, setDrawerSearch] = useState(false);
  // Pull-down from Chat opens Search over Chat; its back button returns to Chat, not the drawer.
  const [searchFromChat, setSearchFromChat] = useState(false);
  const [side, setSide] = useState<"left" | "right">("left");
  // The App Drawer is built once while idle and kept (hidden) off-screen, so a swipe only moves
  // it: the first pixel of finger travel is the first pixel of drawer travel, like Projects.
  const [prewarmed, setPrewarmed] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const sideRef = useRef<"left" | "right">("left");
  const layer = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const frame = useRef(0);
  const opened = useRef(false);
  const settleRef = useRef<(open: boolean, velocity?: number, to?: "left" | "right") => void>(() => {});
  const drag = useRef<Drag | null>(null);
  const target = useRef<Element | null>(null);
  const suppressClick = useRef(false);
  const lastFocus = useRef<HTMLElement | null>(null);
  const current = useRef({ enabled, directDrawer, location, navigate, router });
  current.current = { enabled, directDrawer, location, navigate, router };
  // Writes only the panel's transform and the scrim's opacity. An inherited CSS variable on the
  // layer restyled every element inside the drawer on every frame, which made it stutter.
  const transformFor = (panelSide: "left" | "right", value: number) => `translate3d(${(panelSide === "right" ? 1 - value : value - 1) * 100}%, 0, 0)`;
  const panelTransform = (value: number) => transformFor(sideRef.current, value);
  const parts = (node: HTMLElement | null) => ({
    panel: node?.querySelector<HTMLElement>(`:scope > .navigation-drawer-panel[data-side=${sideRef.current}]`) ?? null,
    other: node?.querySelector<HTMLElement>(`:scope > .navigation-drawer-panel[data-side=${sideRef.current === "right" ? "left" : "right"}]`) ?? null,
    scrim: node?.querySelector<HTMLElement>(":scope > .navigation-drawer-scrim") ?? null,
  });
  const applyProgress = (node: HTMLElement | null, value: number) => {
    const { panel, other, scrim } = parts(node);
    if (panel) panel.style.transform = panelTransform(value);
    // The kept App Drawer stays parked off-screen while Projects is the moving panel.
    if (other) { const closed = transformFor(other.dataset.side === "right" ? "right" : "left", 0); if (other.style.transform !== closed) other.style.transform = closed; }
    if (scrim) scrim.style.opacity = String(value);
  };
  const paint = (value: number) => {
    progress.current = value;
    applyProgress(layer.current, value);
  };
  // A running tap slide is a browser (compositor) animation, so busy chat work can't make it stutter.
  const motion = useRef<{ animations: Animation[]; from: number; to: number} | null>(null);
  const stopMotion = () => {
    cancelAnimationFrame(frame.current);
    const running = motion.current;
    if (!running) return;
    motion.current = null;
    // Freeze where the slide visibly is, so a finger can catch it mid-way.
    const t = Number(running.animations[0].effect?.getComputedTiming().progress ?? 1);
    running.animations.forEach((animation) => animation.cancel());
    paint(running.from + (running.to - running.from) * t);
  };
  const show = (to: "left" | "right" = sideRef.current) => {
    if (opened.current) return;
    sideRef.current = to; setSide(to);
    lastFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    opened.current = true;
    // Reveal the kept layer right now, without waiting for React, so it moves with this touch.
    layer.current?.setAttribute("data-open", "true");
    paint(progress.current);
    setVisible(true);
  };
  const dismiss = () => {
    const wasOpen = opened.current;
    opened.current = false; setVisible(false); setDrawerSearch(false); setSearchFromChat(false); paint(0);
    layer.current?.removeAttribute("data-open");
    if (wasOpen) {
      setResetKey((key) => key + 1);
      if (lastFocus.current?.isConnected && layer.current?.contains(document.activeElement)) lastFocus.current.focus({ preventScroll: true });
    }
  };
  const settle = (open: boolean, initialVelocity = 0, to?: "left" | "right") => {
    stopMotion();
    // A tap opens a panel that isn't mounted yet: build and paint it off-screen first, so
    // mounting never eats the first frames of the slide.
    // The kept App Drawer is already built, so it can start sliding at once.
    const mounting = open && !opened.current && !layer.current?.querySelector(`:scope > .navigation-drawer-panel[data-side=${to ?? sideRef.current}]`);
    if (open) show(to);
    const target = open ? 1 : 0;
    let velocity = initialVelocity;
    let previous = -1;
    const finish = () => {
      paint(target);
      if (!open) dismiss();
      else layer.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    };
    if (isMotionReduced()) { finish(); return; }
    // Taps (and still releases) have no finger speed: they get the quick glide a flicked
    // Projects swipe has; flicks keep the spring that continues the finger's speed.
    const glide = Math.abs(initialVelocity) < 0.5;
    const tick = (now: number) => {
      // The first frame only records the clock, so a slow frame never becomes a jump.
      const next = previous < 0 ? { position: progress.current, velocity } : springStep(progress.current, velocity, target, (now - previous) / 1000);
      previous = now; velocity = next.velocity; paint(next.position);
      if (Math.abs(target - next.position) < 0.001 && Math.abs(velocity) < 0.01) finish();
      else frame.current = requestAnimationFrame(tick);
    };
    const slide = () => {
      const { panel, scrim } = parts(layer.current);
      const from = progress.current;
      if (!panel || typeof panel.animate !== "function" || from === target) { finish(); return; }
      const options: KeyframeAnimationOptions = { duration: glideDuration(Math.abs(target - from)), easing: GLIDE_EASE };
      const animations = [panel.animate([{ transform: panelTransform(from) }, { transform: panelTransform(target) }], options)];
      if (scrim) animations.push(scrim.animate([{ opacity: from }, { opacity: target }], options));
      paint(target); // resting style underneath; the animation covers it until it ends
      const running = { animations, from, to: target };
      motion.current = running;
      animations[0].onfinish = () => { if (motion.current !== running) return; motion.current = null; animations.forEach((a) => a.cancel()); finish(); };
    };
    const begin = glide ? slide : tick;
    let waited = 0;
    let smoothFrames = 0;
    let last = -1;
    const ready = (now: number) => {
      // Start only once the panel exists and two frames in a row ran on time (its setup work is
      // done); otherwise a long setup frame would swallow the start of the slide. Capped ~0.5s.
      smoothFrames = layer.current && last >= 0 && now - last < 26 ? smoothFrames + 1 : 0;
      last = now;
      if (smoothFrames < 2 && waited++ < 30) { frame.current = requestAnimationFrame(ready); return; }
      if (glide) slide(); else frame.current = requestAnimationFrame(tick);
    };
    if (mounting) frame.current = requestAnimationFrame(ready);
    else if (glide) slide();
    else frame.current = requestAnimationFrame(begin);
  };
  settleRef.current = settle;
  const sign = () => (sideRef.current === "right" ? -1 : 1);

  const previous = useRef<{ path: string; index?: number } | null>(null);
  useEffect(() => {
    const state = location.state as { __TSR_index?: number; __visionOpenDrawer?: boolean; __visionOpenProjects?: boolean } | undefined;
    const prev = previous.current;
    previous.current = { path: location.pathname, index: state?.__TSR_index };
    stopMotion(); drag.current = null; dismiss();
    // Closing Library/Plugins/Settings returns to the App Drawer, already open.
    const backFromDrawerPage = prev && gestureSurface(prev.path) === "drawer-page" && state?.__TSR_index !== undefined && prev.index !== undefined && state.__TSR_index < prev.index;
    if (enabled && gestureSurface(location.pathname) === "chat" && (state?.__visionOpenDrawer || backFromDrawerPage)) { show("left"); paint(1); }
    else if (enabled && gestureSurface(location.pathname) === "chat" && state?.__visionOpenProjects) { show("right"); paint(1); }
    // A browser back from a drawer page drops the forward entry, so the closed page can't be swiped back open.
    if (backFromDrawerPage && enabled) router.history.push(location.href, { ...(location.state as object), __visionOpenDrawer: true } as never);
  }, [location.pathname, location.searchStr]);
  useEffect(() => {
    const open = (event: Event) => {
      if (!current.current.enabled || current.current.directDrawer) return;
      event.preventDefault(); settleRef.current(true, 0, "left");
    };
    const openProjects = (event: Event) => {
      if (!current.current.enabled || gestureSurface(current.current.location.pathname) !== "chat") return;
      event.preventDefault(); settleRef.current(true, 0, "right");
    };
    const back = (event: Event) => {
      if (!opened.current) return;
      event.preventDefault(); settleRef.current(false);
    };
    const historyBack = () => { if (opened.current) settleRef.current(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && opened.current) { event.preventDefault(); settleRef.current(false); } };
    const down = (event: TouchPoint) => {
      if (!current.current.enabled || event.pointerType !== "touch" || !event.isPrimary || drag.current) return;
      if (document.querySelector("[role='dialog']:not([data-navigation-drawer]), [role='alertdialog'], [role='menu'][data-state='open']")) return;
      if (!(event.target instanceof Element)) return;
      // Typing fields only block swipes while focused, so the composer area still swipes.
      const field = event.target.closest("input, textarea, select, [contenteditable=true]");
      if (field && field === document.activeElement) return;
      if (event.target.closest("[role=slider], [data-navigation-gesture=off]")) return;
      target.current = event.target;
      const edge = event.clientX <= 24;
      const drawer = opened.current || current.current.directDrawer;
      if (!drawer && gestureSurface(current.current.location.pathname) !== "other") {
        // Chat, Projects and drawer pages: swipe from anywhere, except horizontally scrolling content.
        stopMotion();
        target.current = event.target;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, time: performance.now(), start: 0, velocity: 0, kind: "pending", active: false, header: fromHeader(event.target, event.clientY) };
        return;
      }
      if (!drawer && !edge && event.target.closest("button, a, [role=button], pre, table, [role=tablist]")) return;
      let ancestor: Element | null = event.target;
      while (ancestor && !edge && !drawer) {
        if (ancestor.scrollWidth > ancestor.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(ancestor).overflowX)) return;
        ancestor = ancestor.parentElement;
      }
      if (!drawer && !edge && !current.current.router.history.canGoBack()) return;
      stopMotion();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, time: performance.now(), start: current.current.directDrawer ? 1 : opened.current ? progress.current : 0, velocity: 0, kind: drawer || edge ? "drawer" : "back", active: false, header: fromHeader(event.target, event.clientY) };
    };
    const move = (event: TouchPoint) => {
      const gesture = drag.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      if (!gesture.active) {
        // Accidental-touch guard: a resting thumb or tiny drift never commits to a gesture.
        if (Math.max(Math.abs(dx), Math.abs(dy)) < (Math.abs(dx) >= Math.abs(dy) * 2 ? 6 : 10)) return;
        // Downward moves that don't start in the header are always plain scrolling — never a gesture.
        if (dy > 0 && dy >= Math.abs(dx) * 1.2 && !gesture.header) { if (gesture.kind === "pending") { drag.current = null; return; } }
        // Pull-down search: only a quick downward swipe that starts on the header (never a slow scroll-drag).
        else if (dy > 0 && dy >= Math.abs(dx) * 1.2 && !scrollsUp(event.target instanceof Element ? event.target : target.current)) {
          if (dy < 36) return;
          if (dy / Math.max(1, performance.now() - gesture.time) < 0.25) { drag.current = null; return; }
          if (target.current?.closest("[data-projects-search]")) {
            drag.current = null;
            if (requestProjectsSearch(target.current)) { event.preventDefault(); suppressClick.current = true; }
            return;
          }
          if (gesture.kind === "pending" && gestureSurface(current.current.location.pathname) === "chat") {
            drag.current = null; suppressClick.current = true;
            setDrawerSearch(true); setSearchFromChat(true); settleRef.current(true, 0, "left");
            return;
          }
          if (gesture.kind === "drawer" && ((opened.current && sideRef.current === "left") || current.current.directDrawer)) {
            drag.current = null; suppressClick.current = true;
            requestSearch();
            return;
          }
        }
        // Horizontally scrollable rows (e.g. Search filter chips) keep their scroll; the page must not close.
        if (gesture.kind === "drawer" && scrollsX(target.current, dx)) { drag.current = null; return; }
        if (gesture.kind === "pending") {
          // Only content that can still scroll in the swipe's direction keeps the swipe.
          const action = Math.abs(dy) * 1.2 >= Math.abs(dx) || scrollsX(target.current, dx) ? null : swipeAction(gestureSurface(current.current.location.pathname), dx);
          if (!action) { drag.current = null; return; }
          if (action === "drawer" || action === "projects") sideRef.current = action === "projects" ? "right" : "left";
          gesture.kind = action === "projects" ? "drawer" : action;
        }
        if (Math.abs(dy) >= Math.abs(dx) || (gesture.start === 0 && (gesture.kind === "drawer" ? dx * sign() < 0 : gesture.kind === "back" && dx < 0))) {
          drag.current = null;
          if (opened.current) settleRef.current(gesture.start > 0.5);
          return;
        }
        gesture.active = true; suppressClick.current = true;
        if (gesture.kind === "drawer" && !current.current.directDrawer) show(sideRef.current);
      }
      event.preventDefault();
      const now = performance.now();
      gesture.velocity = (event.clientX - gesture.lastX) / Math.max(1, now - gesture.time) * 1000 / window.innerWidth;
      gesture.time = now; gesture.lastX = event.clientX;
      if (gesture.kind === "drawer") {
        const value = drawerProgress(gesture.start, dx, window.innerWidth);
        if (current.current.directDrawer) document.querySelector<HTMLElement>("[aria-label='App drawer']")?.style.setProperty("translate", `${(value - 1) * 100}% 0`);
        else paint(drawerProgress(gesture.start, dx * sign(), window.innerWidth));
      }
    };
    const release = (event: TouchPoint) => {
      const gesture = drag.current;
      if (!gesture || gesture.id !== event.pointerId) return;
      drag.current = null;
      const cancelled = event.type === "pointercancel";
      if (performance.now() - gesture.time > 100) gesture.velocity = 0;
      const dx = event.clientX - gesture.x;
      const commit = (sign: 1 | -1) => !cancelled && gesture.active && settleDrawer(drawerProgress(0, sign * dx, window.innerWidth), sign * gesture.velocity);
      const nav = current.current.navigate;
      if (gesture.kind === "pending") { /* never activated */ }
      else if (gesture.kind === "to-chat") { if (commit(1)) nav(-1); }
      else if (gesture.kind === "to-drawer") { if (commit(-1)) nav(-1); }
      else if (gesture.kind === "back") {
        if (!cancelled && gesture.active && settleDrawer(drawerProgress(0, event.clientX - gesture.x, window.innerWidth), gesture.velocity)) current.current.navigate(-1);
      } else if (current.current.directDrawer) {
        const page = document.querySelector<HTMLElement>("[aria-label='App drawer']");
        page?.style.removeProperty("translate");
        if (!cancelled && gesture.active && !settleDrawer(drawerProgress(1, event.clientX - gesture.x, window.innerWidth), gesture.velocity)) {
          const target = safeReturnPath(new URLSearchParams(current.current.location.searchStr).get("returnTo"));
          current.current.navigate(target.startsWith("/drawer") ? "/chat" : target, { direction: "back", replace: true });
        } else if (gesture.active && !isMotionReduced()) page?.animate([{ translate: `${(drawerProgress(1, gesture.lastX - gesture.x, window.innerWidth) - 1) * 100}% 0` }, { translate: "0% 0" }], { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      } else if (gesture.active || opened.current) settleRef.current(cancelled ? gesture.start > 0.5 : settleDrawer(progress.current, gesture.velocity * sign()), gesture.velocity * sign());
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick.current = false;
    };
    const preference = () => { if (isMotionReduced() && opened.current) settleRef.current(progress.current >= 0.5); };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new MutationObserver(preference);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", preference);
    document.addEventListener(DRAWER_EVENT, open);
    document.addEventListener(PROJECTS_EVENT, openProjects);
    document.addEventListener(`${DRAWER_EVENT}:back`, back);
    window.addEventListener("popstate", historyBack);
    document.addEventListener("keydown", key);
    const each = (handler: (point: TouchPoint) => void, cancel = false) => (event: TouchEvent) => {
      // A second finger (pinch) cancels any swipe in progress.
      if (event.type === "touchstart" && event.touches.length > 1) { const g = drag.current; if (g) release({ ...fromTouch(event, event.changedTouches[0], true), pointerId: g.id }); return; }
      for (const touch of Array.from(event.changedTouches)) handler(fromTouch(event, touch, cancel));
    };
    const onStart = each(down), onMove = each(move), onEnd = each(release), onCancel = each(release, true);
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onMove, { capture: true, passive: false });
    document.addEventListener("touchend", onEnd, true);
    document.addEventListener("touchcancel", onCancel, true);
    document.addEventListener("click", click, true);
    return () => {
      stopMotion();
      document.removeEventListener(DRAWER_EVENT, open);
      document.removeEventListener(PROJECTS_EVENT, openProjects);
      document.removeEventListener(`${DRAWER_EVENT}:back`, back);
      window.removeEventListener("popstate", historyBack);
      document.removeEventListener("keydown", key);
      document.removeEventListener("touchstart", onStart, true);
      document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("touchend", onEnd, true);
      document.removeEventListener("touchcancel", onCancel, true);
      document.removeEventListener("click", click, true);
      media.removeEventListener("change", preference); observer.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!enabled || directDrawer || prewarmed) return;
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = typeof w.requestIdleCallback === "function";
    const id = idle ? w.requestIdleCallback!(() => setPrewarmed(true), { timeout: 2500 }) : window.setTimeout(() => setPrewarmed(true), 1500);
    return () => { if (idle) w.cancelIdleCallback?.(id); else clearTimeout(id); };
  }, [enabled, directDrawer, prewarmed]);
  const drawerActions = useMemo(() => ({
    onClose: () => settleRef.current(false),
    onNewChat: () => { settleRef.current(false); current.current.navigate("/chat"); },
    onSelectChat: (id: string) => { settleRef.current(false); current.current.navigate(`/chat/${id}`); },
  }), []);
  const closeSearch = useMemo(() => () => settleRef.current(false), []);
  if (!enabled || directDrawer) return null;
  const drawerOpen = visible && side === "left";
  return <>
    {!visible && <div className="navigation-edge" aria-hidden="true" />}
    {(visible || prewarmed) && createPortal(<div className="navigation-drawer" data-open={visible ? "true" : undefined} ref={(node) => { layer.current = node; if (node) applyProgress(node, progress.current); }}>
      <div className="navigation-drawer-scrim" aria-hidden="true" onClick={() => settleRef.current(false)} />
      <div className="navigation-drawer-panel" data-side="left" data-navigation-drawer role={drawerOpen ? "dialog" : undefined} aria-modal={drawerOpen ? true : undefined} aria-label="Workspace navigation">
        <DrawerView {...drawerActions} resetKey={resetKey} initialSearch={drawerSearch} onSearchBack={searchFromChat ? closeSearch : undefined} activeChatId={location.pathname.match(/^\/chat\/([^/]+)$/)?.[1]} />
      </div>
      {visible && side === "right" && <div className="navigation-drawer-panel" data-side="right" data-navigation-drawer role="dialog" aria-modal="true" aria-label="Projects">
        <Projects onClose={drawerActions.onClose} />
      </div>}
    </div>, document.body)}
  </>;
}
