export type GuideEntry = { title: string; steps: string[]; note?: string };
export type GuideSection = { id: string; title: string; entries: GuideEntry[] };

export const APP_GUIDE: GuideSection[] = [
  { id: "navigation", title: "Navigation & gestures", entries: [
    { title: "Chat, App Drawer & Projects", steps: ["Chat is home. Swipe left to right to open the App Drawer; swipe right to left to open Projects.", "Start at the top, middle or bottom of a main screen—no edge start is required.", "Swipe right to left in the drawer to close it. Swipe left to right in Projects to return to Chat.", "Menu, Projects and Back buttons are alternatives to gestures."] },
    { title: "Library, Plugins & Settings", steps: ["Tap Library or Plugins in the drawer. Tap your profile icon to open Settings.", "Back or a right-to-left swipe closes these main pages into the Chat workspace with the drawer available, never an unrelated recently visited page.", "Tap a button to reopen the page; swiping does not reopen the last closed page.", "Back in a Settings subpage returns to Settings. Back from a project returns to Projects."] },
    { title: "Pull down to search", steps: ["At the top of Chat, pull downward to open workspace Search. Its Back button returns to Chat.", "Pull down in the drawer or tap Search to transform the drawer into Search. Back restores the drawer.", "Pull down in Projects to open only Projects search.", "Normal vertical scrolling takes priority: pull-down search waits until the content under your finger cannot scroll upward."] },
    { title: "Scroll without navigating", steps: ["Swipe filter chips, icons and category rows sideways to scroll them.", "Scrollable rows keep their gestures while they can scroll in that direction. Start outside the row to navigate.", "Use one finger and a clear horizontal or downward movement. Focused fields and interactive controls may keep their own gestures."], note: "Use buttons if a gesture is difficult. Reduce Motion changes animations, not destinations." },
  ] },
  { id: "chat", title: "Chats & AI modes", entries: [
    { title: "Start and continue a conversation", steps: ["Type a request and send it. Include your goal, context and desired output.", "Ask follow-ups in the same conversation to retain context. Use Stop to interrupt a reply.", "Open the drawer to revisit a saved chat or start a new one. Use a chat’s options menu for its available management actions.", "Use the microphone for voice input when supported and allow browser microphone access if asked."] },
    { title: "Choose a mode", steps: ["Use the mode selector beside the message box before sending.", "Default handles everyday tasks. Deep Thinking handles more involved reasoning. Research creates structured research reports. Coding helps write, review and debug code.", "The mode belongs to the conversation until changed. Settings → AI Preferences controls the default for new chats."], note: "Research has limited source coverage; full web search is not connected. Verify important claims and sources." },
    { title: "Incognito", steps: ["Use Incognito for a temporary regular conversation.", "Incognito is not saved in history. Refreshing can lose the conversation.", "Project chats do not support Incognito."], note: "Incognito controls saved history, not service processing. Never share passwords or secrets." },
    { title: "Attachments and outputs", steps: ["Use the attachment control to choose files; remove unwanted files before sending.", "Explain what to do with the material: summarize, compare, extract data or convert a supported format.", "Use the available copy or download actions on replies and outputs. Find saved files in Library."], note: "Supported formats and limits vary by tool. Follow any upload or processing error shown." },
  ] },
  { id: "projects", title: "Projects & memory", entries: [
    { title: "Create and find projects", steps: ["Open Projects from Chat and tap +.", "Enter a name of up to 50 characters. Scroll the icon and category rows horizontally to choose an option.", "Choose a Memory preference and tap Create project. Cancel leaves without creating it.", "Pull down in Projects to search project names. Clear the query to show the full list."], note: "Headers shorten long names; the full name remains saved." },
    { title: "Default and Project memory", steps: ["Default saves the normal memory preference. Project only saves a preference for memory scoped to that project.", "Select one of the two Memory rows during creation."], note: "Memory preferences currently save a setting only; they do not yet change memory used in AI replies. Project only is not an enforced privacy boundary." },
    { title: "Chats, sources and instructions", steps: ["Open a project and use Chats to continue or start a related conversation.", "Switch to Sources to manage reference files and follow the displayed upload limits.", "Use the project menu to edit instructions or details, pin the project or delete it after confirmation.", "Share project opens device sharing or copies a link; a link does not grant private-project access."], note: "Saved instructions or sources do not guarantee every reply uses them. Review the answer before relying on it." },
  ] },
  { id: "library", title: "Library & workspace search", entries: [
    { title: "Find chats and files", steps: ["Open Library from the drawer, or pull down in Chat or the drawer for workspace Search.", "Enter a query and choose Recent Chats, Uploaded Files or Generated Items to narrow results.", "Scroll the filter row horizontally for more choices. Use available view and sorting controls to organize items.", "Tap a result to open it and use its available menu actions to manage it."] },
    { title: "Search Back destinations", steps: ["Search started from Chat returns to Chat. Search started from the drawer returns to the drawer.", "Projects search belongs only to Projects and never opens workspace Search."] },
  ] },
  { id: "tools", title: "Code, tables & Plugins", entries: [
    { title: "Code and previews", steps: ["Use a code block’s copy or viewer controls to inspect full code.", "Use the available search, wrap and zoom controls in the viewer. Supported content has a preview; larger screens offer additional tools.", "Close the full-screen viewer to return to the conversation."], note: "A preview is not a production build or security review. Review generated code before using it." },
    { title: "Tables and copying", steps: ["Copy each table independently using its own control.", "Sort supported columns to compare rows. This changes the view, not the original response.", "Download CSV to open table data in a spreadsheet. Text boxes and code blocks have independent copy controls."] },
    { title: "Plugins and conversions", steps: ["Open Plugins from the drawer and choose an available tool.", "Choose an input file and output format where offered; follow progress and download the result.", "Tools marked unavailable cannot be used until enabled or connected."], note: "Not every listed plugin is connected; conversion support varies by format. Vision does not generate or edit images or videos." },
  ] },
  { id: "settings", title: "Settings, account & accessibility", entries: [
    { title: "Personalize the app", steps: ["Open Settings through the drawer’s profile icon.", "Appearance controls theme, accent and text size; Language holds the interface language preference.", "AI Preferences includes the new-chat mode, answer style, tone and custom instructions.", "Accessibility includes Reduce Motion, contrast and tap-size options.", "Notifications manages browser alerts. Check browser permission if alerts are blocked."], note: "Some preferences depend on browser support and feature availability." },
    { title: "Export, privacy and deletion", steps: ["Settings → Chat & History offers chat export and clearing saved conversations.", "Privacy & Data contains data export, research-document management and available deletion controls.", "Export a copy before deleting anything you want to keep."], note: "Deletion can be permanent. Read each confirmation carefully." },
    { title: "Account, security and help", steps: ["Manage account updates available profile details. Inbox contains account messages; Upgrade plan shows plan options.", "Security contains password and two-step sign-in controls. Use password recovery if you cannot sign in.", "Help contains App Guide, FAQ and Support. Use Log out on shared devices."], note: "Never send passwords, verification codes or secrets to Support." },
  ] },
  { id: "guidelines", title: "Guidelines & troubleshooting", entries: [
    { title: "Use AI responsibly", steps: ["State the task, audience, constraints and desired format. Attach only necessary material.", "Ask follow-ups when an answer is unclear. Check facts, calculations, sources and generated files.", "AI can make mistakes in every mode. Verify medical, legal, financial and security decisions with qualified professionals."] },
    { title: "Resolve common problems", steps: ["For missed gestures, start outside scrollable rows or focused fields, or use buttons.", "For search, clear filters and try a shorter query. For uploads, check file types and limits.", "For voice or notifications, check browser permissions. For stalled replies, check your connection and retry.", "Copy temporary text before refreshing, especially in Incognito.", "If problems continue, open Settings → Help → Support and include the page, action, device and error message."] },
  ] },
];

export function filterGuide(sections: GuideSection[], query: string): GuideSection[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return sections;
  return sections.flatMap((section) => {
    const entries = section.entries.filter((entry) => {
      const text = [section.title, entry.title, ...entry.steps, entry.note ?? ""].join(" ").toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
    return entries.length ? [{ ...section, entries }] : [];
  });
}
