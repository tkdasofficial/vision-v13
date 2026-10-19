/** Shared copy for the first-run tutorial and the App Usage Guide page. */
export const GESTURE_STEPS = [
  { title: "Chat is home", body: "Vision always opens on Chat. Type or speak a message to get started." },
  { title: "Swipe right for the App Drawer", body: "Drag left to right anywhere on Chat to open the drawer with your recent chats. Drag back to close it." },
  { title: "Swipe left for Projects", body: "Drag right to left anywhere on Chat to open Projects. Drag left to right to return to Chat." },
  { title: "Library, Plugins & Settings", body: "Open them from the App Drawer buttons. Swipe right to left or tap Back to return to the drawer." },
] as const;

export const FEATURE_TIPS = [
  { title: "Modes", body: "Pick a chat mode such as Deep Thinking; it stays on for that conversation." },
  { title: "Files", body: "Attach files to a chat, or convert them between formats. Find them later in Library." },
  { title: "Incognito", body: "Start a temporary chat that is never saved." },
  { title: "Search", body: "Use the search button in the drawer to find chats and files." },
] as const;

const NEW_USER_WINDOW_MS = 48 * 60 * 60 * 1000;
export const tutorialKey = (userId: string) => `vision_tutorial_seen:${userId}`;

/** Shows once, only for accounts created recently (i.e. right after sign-up). */
export function shouldShowTutorial(user: { id: string; created_at?: string } | null | undefined, seen: boolean, now = Date.now()): boolean {
  if (!user || seen || !user.created_at) return false;
  const created = Date.parse(user.created_at);
  return Number.isFinite(created) && now - created >= 0 && now - created < NEW_USER_WINDOW_MS;
}
