# VISION — All-in-one AI Workspace

VISION is a full-stack AI chat workspace built with **TanStack Start (React 19, Vite 7)** and deployed on **Cloudflare Workers**. Data lives in **Cloudflare D1**, files in **Google Drive**, and AI runs on **Groq, NVIDIA and Cloudflare Workers AI**.

## App summary

### Authentication & security
- Email + password sign-up/login (PBKDF2 hashes), 8-digit email verification codes sent via Gmail SMTP.
- Google & GitHub sign-in through a central Cloudflare Worker gateway (`auth-gateway/`, deployed as `vision.tusharkantidasofficial.workers.dev`): PKCE, sealed state, exact-origin allowlist, Ed25519-signed single-use assertions.
- Sessions: hashed tokens in D1, HttpOnly cookie, 30-day sliding renewal, login history (device + IP, pruned after 180 days), same-origin checks on every state-changing call.
- Forgot Password (signed-out: `/auth/forget-password` → `/auth/verify` → `/verify/confirm-password`) and Reset Password (signed-in: Settings → Security, stays signed in, other devices signed out).
- Central route guard (`src/lib/route-access.ts` + `RouteGuard`): public, guest-only, protected and recovery pages; no flash of private content; network hiccups retry instead of signing out.
- Signup security pipeline in `security/` (bot detection, rate limits, risk scoring, disposable-email checks, audit log), tested in `security/tests`.
- Enterprise Login (VISION BDI) with DNS TXT domain ownership proof.

### AI chat
- Four modes: **Default, Deep Thinking, Research, Coding**, with an automatic per-message task router in Default.
- Streaming replies from `/api/chat`; up to 3 model fallbacks per mode; self-verification for hard questions; image understanding.
- Research mode searches the web (Wikipedia + DuckDuckGo), cites sources and saves reports as documents (`/documents/$docId`, PDF download).
- Code replies render in code boxes with copy, full-screen view and download.
- Incognito chats (not saved), chat history, export and delete.

### Pages
- Main chat (`/chat`, `/chat/$chatId`, `/chat/incognito`), Search, Library, Projects, Images, Videos, Inbox, Integrations, Prospecting, Support, Upgrade, Account.
- Settings directory with 9 sub-pages: Appearance, Language, AI Preferences, Chat & History, Privacy & Data, Security, Accessibility, Notifications, About VISION.
- Admin area: dashboard, users, analytics, announcements, audit, feature flags, reports, subscriptions, support, system.
- Public: Login, Sign up, Forgot password, Privacy Policy, Terms of Service, FAQ.
- Light (#F5F5F5) and dark (#080808) themes following the device, with accent, text-size and accessibility options.

### Known open items
- Plans & Pricing list is empty; two-step sign-in not built; notification alerts saved but not sent; web search limited to Wikipedia/DuckDuckGo; About version "1.0.0" is a placeholder.

## Development

```sh
bun install
bun run dev      # local dev server
bun run test     # run tests
bun run build    # production build
```

Database schema: `db/schema.sql` (apply with `wrangler d1 execute vision --remote --file db/schema.sql`). Secrets (Groq, NVIDIA, Google app password, Cloudflare) are server-side only; `.env` is not included in the download.

## Routes

| Page | Path | Old path (redirects) |
|---|---|---|
| New chat | /chat | /app/new |
| Conversation | /chat/$chatId | /app/chat/$chatId |
| Incognito | /chat/incognito | /app/incognito |
| Images / Videos | /studio/images, /studio/videos | /app/images, /app/videos |
| Library, Projects, Integrations, Search, Inbox, Account, Prospecting, Support | /library, /projects, /integrations, /search, /inbox, /account, /prospecting, /support | /app/... |
| New project | /projects/new | /app/project-create |
| Research report | /documents/$docId | /app/doc/$docId |
| Plans | /billing/plans | /app/upgrade |
| Settings | /settings, /settings/{appearance,language,ai,chat,privacy,security,accessibility,notifications,about} | /app/settings/... |
| Reset password (signed in) | /settings/security/password | /app/settings/reset-password |
| Login / Register / Forgot password | /auth/login, /auth/register, /auth/forgot-password | /auth/signup, /auth/forget-password |
| OTP check (all flows) | /auth/verify | — |
| Set new password | /auth/reset-password | /verify/confirm-password |
| OAuth return | /auth/google/callback, /auth/github/callback | /google/callback, /github/callback (still served, not redirected) |
| OAuth start API | /api/oauth/$provider | /api/auth/$provider (removed) |
| FAQ / Privacy / Terms | /help/faq, /legal/privacy, /legal/terms | /docs/... |
| Enterprise | /enterprise, /enterprise/login, /enterprise/verify, /enterprise/getting-started | /enterprise/email |
| Admin | /admin/* (unchanged) | — |

## Folder structure

```text
.
├── .gitignore
├── .lovable
│   ├── plan
│   │   └── settings-refinement-research-web-search-2026-10-10.md
│   └── project.json
├── .prettierignore
├── .prettierrc
├── .workspace
├── AGENTS.md
├── README.md
├── auth-gateway
│   ├── src
│   │   └── index.ts
│   └── wrangler.toml
├── bunfig.toml
├── components.json
├── db
│   └── schema.sql
├── eslint.config.js
├── package.json
├── public
│   ├── favicon.ico
│   ├── og-icon.png
│   └── robots.txt
├── roadmap.md
├── security
│   ├── antibot
│   │   └── bot-detection.ts
│   ├── audit
│   │   └── audit-logger.ts
│   ├── config.ts
│   ├── cookies
│   │   └── csrf.ts
│   ├── core
│   │   └── signup-pipeline.ts
│   ├── credits
│   │   └── initial-credit-grant.ts
│   ├── enforcement
│   │   └── restrictions.ts
│   ├── identity
│   │   ├── dns.ts
│   │   ├── domain-verification.ts
│   │   └── email.ts
│   ├── index.ts
│   ├── network
│   │   └── ip.ts
│   ├── rate-limits
│   │   └── rate-limit-engine.ts
│   ├── risk
│   │   └── risk-engine.ts
│   ├── storage
│   │   └── memory-store.ts
│   ├── tests
│   │   └── security.test.ts
│   ├── types.ts
│   └── utils
│       └── crypto.ts
├── src
│   ├── AGENTS.md
│   ├── assets
│   │   ├── logo.svg
│   │   ├── reference-1.jpg
│   │   ├── reference-2.jpg
│   │   ├── reference-3.jpg
│   │   ├── reference-4.jpg
│   │   ├── reference-5.jpg
│   │   ├── reference-6.jpg
│   │   ├── reference-7.jpg
│   │   └── reference-8.jpg
│   ├── components
│   │   ├── agent-progress-card
│   │   │   └── index.tsx
│   │   ├── ai-elements
│   │   │   └── prompt-input
│   │   │       └── index.tsx
│   │   ├── announcement-banner
│   │   │   └── index.tsx
│   │   ├── chat
│   │   │   ├── code-block
│   │   │   │   └── index.tsx
│   │   │   ├── document-card
│   │   │   │   └── index.tsx
│   │   │   ├── full-screen-code-view
│   │   │   │   └── index.tsx
│   │   │   └── use-copy.ts
│   │   ├── chat-input
│   │   │   └── index.tsx
│   │   ├── chat-message
│   │   │   └── index.tsx
│   │   ├── chat-workspace
│   │   │   └── index.tsx
│   │   ├── creation-empty-state
│   │   │   └── index.tsx
│   │   ├── desktop-sidebar
│   │   │   └── index.tsx
│   │   ├── empty-state
│   │   │   └── index.tsx
│   │   ├── file-converter-card
│   │   │   └── index.tsx
│   │   ├── file-creator-card
│   │   │   └── index.tsx
│   │   ├── icons
│   │   │   └── incognito-icon
│   │   │       └── index.tsx
│   │   ├── mobile-sidebar
│   │   │   └── index.tsx
│   │   ├── mode-selector
│   │   │   └── index.tsx
│   │   ├── page-header
│   │   │   └── index.tsx
│   │   ├── profile-menu
│   │   │   └── index.tsx
│   │   ├── protected
│   │   │   └── index.tsx
│   │   ├── route-guard
│   │   │   └── index.tsx
│   │   ├── settings
│   │   │   └── settings-ui
│   │   │       └── index.tsx
│   │   ├── sidebar-actions
│   │   │   └── index.tsx
│   │   ├── sidebar-features
│   │   │   └── index.tsx
│   │   ├── story
│   │   │   └── story-flow-card
│   │   │       └── index.tsx
│   │   ├── tts-card
│   │   │   └── index.tsx
│   │   ├── typing-indicator
│   │   │   └── index.tsx
│   │   ├── ui
│   │   │   ├── accordion.tsx
│   │   │   ├── alert-dialog.tsx
│   │   │   ├── alert.tsx
│   │   │   ├── aspect-ratio.tsx
│   │   │   ├── avatar.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── breadcrumb.tsx
│   │   │   ├── button.tsx
│   │   │   ├── calendar.tsx
│   │   │   ├── card.tsx
│   │   │   ├── carousel.tsx
│   │   │   ├── chart.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── collapsible.tsx
│   │   │   ├── command.tsx
│   │   │   ├── context-menu.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── drawer.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── form.tsx
│   │   │   ├── hover-card.tsx
│   │   │   ├── input-group.tsx
│   │   │   ├── input-otp.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── menubar.tsx
│   │   │   ├── navigation-menu.tsx
│   │   │   ├── pagination.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── radio-group.tsx
│   │   │   ├── resizable.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── select.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── sheet.tsx
│   │   │   ├── sidebar.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── sonner.tsx
│   │   │   ├── spinner.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── textarea.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── toaster.tsx
│   │   │   ├── toggle-group.tsx
│   │   │   ├── toggle.tsx
│   │   │   └── tooltip.tsx
│   │   ├── video-editor-card
│   │   │   └── index.tsx
│   │   ├── video-generation-card
│   │   │   └── index.tsx
│   │   ├── web-app-preview-card
│   │   │   └── index.tsx
│   │   ├── workspace-shell
│   │   │   └── index.tsx
│   │   └── zip-analysis-card
│   │       └── index.tsx
│   ├── context
│   │   ├── AuthContext.tsx
│   │   └── ChatHistoryContext.tsx
│   ├── hooks
│   │   ├── use-mobile.tsx
│   │   ├── use-toast.ts
│   │   ├── useBackgroundTasks.ts
│   │   └── useSettings.ts
│   ├── lib
│   │   ├── admin-audit.ts
│   │   ├── agent-executor.ts
│   │   ├── ai
│   │   │   ├── models.server.ts
│   │   │   ├── modes.ts
│   │   │   ├── prompts.server.ts
│   │   │   ├── providers.server.ts
│   │   │   └── task-router.ts
│   │   ├── append-transcript.ts
│   │   ├── chunk-recovery.ts
│   │   ├── cloud
│   │   │   ├── account-security.functions.ts
│   │   │   ├── auth-gateway.ts
│   │   │   ├── auth.functions.ts
│   │   │   ├── auth.server.ts
│   │   │   ├── chat-stream.ts
│   │   │   ├── client.ts
│   │   │   ├── d1.server.ts
│   │   │   ├── data.functions.ts
│   │   │   ├── documents.functions.ts
│   │   │   ├── drive.server.ts
│   │   │   ├── enterprise.functions.ts
│   │   │   ├── enterprise.server.ts
│   │   │   ├── mail.server.ts
│   │   │   ├── oauth-urls.ts
│   │   │   ├── oauth.server.ts
│   │   │   ├── otp.server.ts
│   │   │   ├── query-types.ts
│   │   │   ├── query.server.ts
│   │   │   ├── schema.server.ts
│   │   │   └── security.server.ts
│   │   ├── code-files.ts
│   │   ├── creation-references.ts
│   │   ├── detect-aspect-ratio.ts
│   │   ├── error-capture.ts
│   │   ├── error-page.ts
│   │   ├── ffmpeg-renderer.ts
│   │   ├── file-converter.ts
│   │   ├── legacy-routes.ts
│   │   ├── long-form-pipeline.ts
│   │   ├── lovable-error-reporting.ts
│   │   ├── onboarding-options.ts
│   │   ├── project-options.ts
│   │   ├── research-pdf.ts
│   │   ├── route-access.ts
│   │   ├── router-compat.tsx
│   │   ├── search
│   │   │   └── search.server.ts
│   │   ├── settings.ts
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   ├── video-editor-engine.ts
│   │   ├── video-pipeline.ts
│   │   ├── web-preview-engine.ts
│   │   ├── workspace-search.test.ts
│   │   ├── workspace-search.ts
│   │   ├── zip-analyzer.ts
│   │   └── zip-export.ts
│   ├── pages
│   │   ├── account
│   │   │   └── index.tsx
│   │   ├── auth
│   │   │   └── index.tsx
│   │   ├── billing-plans
│   │   │   └── index.tsx
│   │   ├── chat
│   │   │   └── index.tsx
│   │   ├── documents
│   │   │   └── index.tsx
│   │   ├── enterprise-getting-started
│   │   │   └── index.tsx
│   │   ├── enterprise-login
│   │   │   └── index.tsx
│   │   ├── faq
│   │   │   └── index.tsx
│   │   ├── getting-started
│   │   │   └── index.tsx
│   │   ├── inbox
│   │   │   └── index.tsx
│   │   ├── integrations
│   │   │   └── index.tsx
│   │   ├── library
│   │   │   └── index.tsx
│   │   ├── privacy
│   │   │   └── index.tsx
│   │   ├── project-create
│   │   │   └── index.tsx
│   │   ├── projects
│   │   │   └── index.tsx
│   │   ├── prospecting
│   │   │   └── index.tsx
│   │   ├── reset-password
│   │   │   └── index.tsx
│   │   ├── search
│   │   │   └── index.tsx
│   │   ├── settings
│   │   │   ├── about
│   │   │   │   └── index.tsx
│   │   │   ├── accessibility
│   │   │   │   └── index.tsx
│   │   │   ├── ai
│   │   │   │   └── index.tsx
│   │   │   ├── appearance
│   │   │   │   └── index.tsx
│   │   │   ├── chat
│   │   │   │   └── index.tsx
│   │   │   ├── index.tsx
│   │   │   ├── language
│   │   │   │   └── index.tsx
│   │   │   ├── notifications
│   │   │   │   └── index.tsx
│   │   │   ├── privacy
│   │   │   │   └── index.tsx
│   │   │   ├── security
│   │   │   │   └── index.tsx
│   │   │   └── security-password
│   │   │       └── index.tsx
│   │   ├── support
│   │   │   └── index.tsx
│   │   ├── terms
│   │   │   └── index.tsx
│   │   └── verify
│   │       └── index.tsx
│   ├── routeTree.gen.ts
│   ├── router.tsx
│   ├── routes
│   │   ├── README.md
│   │   ├── __root.tsx
│   │   ├── account.tsx
│   │   ├── admin.analytics.tsx
│   │   ├── admin.announcements.tsx
│   │   ├── admin.audit.tsx
│   │   ├── admin.background-tasks.tsx
│   │   ├── admin.chat-sessions.tsx
│   │   ├── admin.dashboard.tsx
│   │   ├── admin.feature-flags.tsx
│   │   ├── admin.index.tsx
│   │   ├── admin.notifications.tsx
│   │   ├── admin.reports.tsx
│   │   ├── admin.subscriptions.tsx
│   │   ├── admin.support.tsx
│   │   ├── admin.system.tsx
│   │   ├── admin.tsx
│   │   ├── admin.users.tsx
│   │   ├── api
│   │   │   ├── chat.ts
│   │   │   ├── files.ts
│   │   │   └── oauth.$provider.ts
│   │   ├── app.$.tsx
│   │   ├── app.tsx
│   │   ├── auth.forget-password.tsx
│   │   ├── auth.forgot-password.tsx
│   │   ├── auth.github.callback.ts
│   │   ├── auth.google.callback.ts
│   │   ├── auth.login.tsx
│   │   ├── auth.register.tsx
│   │   ├── auth.reset-password.tsx
│   │   ├── auth.signup.tsx
│   │   ├── auth.tsx
│   │   ├── auth.verify.tsx
│   │   ├── billing.plans.tsx
│   │   ├── chat.$chatId.tsx
│   │   ├── chat.incognito.tsx
│   │   ├── chat.index.tsx
│   │   ├── docs.$.tsx
│   │   ├── documents.$docId.tsx
│   │   ├── enterprise.email.tsx
│   │   ├── enterprise.getting-started.tsx
│   │   ├── enterprise.login.tsx
│   │   ├── enterprise.tsx
│   │   ├── enterprise.verify.tsx
│   │   ├── forgot-password.tsx
│   │   ├── getting-started.tsx
│   │   ├── github.callback.ts
│   │   ├── google.callback.ts
│   │   ├── help.faq.tsx
│   │   ├── inbox.tsx
│   │   ├── index.tsx
│   │   ├── integrations.tsx
│   │   ├── legal.privacy.tsx
│   │   ├── legal.terms.tsx
│   │   ├── library.tsx
│   │   ├── login.tsx
│   │   ├── projects.index.tsx
│   │   ├── projects.new.tsx
│   │   ├── prospecting.tsx
│   │   ├── reset-password.tsx
│   │   ├── search.tsx
│   │   ├── settings.about.tsx
│   │   ├── settings.accessibility.tsx
│   │   ├── settings.ai.tsx
│   │   ├── settings.appearance.tsx
│   │   ├── settings.chat.tsx
│   │   ├── settings.index.tsx
│   │   ├── settings.language.tsx
│   │   ├── settings.notifications.tsx
│   │   ├── settings.privacy.tsx
│   │   ├── settings.security.index.tsx
│   │   ├── settings.security.password.tsx
│   │   ├── settings.tsx
│   │   ├── signup.tsx
│   │   ├── studio.images.tsx
│   │   ├── studio.videos.tsx
│   │   ├── support.tsx
│   │   ├── verify.$.tsx
│   │   └── verify.tsx
│   ├── server.ts
│   ├── start.ts
│   ├── styles.css
│   ├── test
│   │   ├── app-routing.test.tsx
│   │   ├── append-transcript.test.ts
│   │   ├── auth-gateway.test.ts
│   │   ├── creation-empty-state.test.tsx
│   │   ├── empty-state.test.tsx
│   │   ├── enterprise-login.test.ts
│   │   ├── example.test.ts
│   │   ├── oauth-providers.test.ts
│   │   ├── otp-drive.test.ts
│   │   ├── route-access.test.ts
│   │   ├── security-integration.test.ts
│   │   ├── setup.ts
│   │   └── task-router.test.ts
│   ├── types
│   │   └── cloudflare-sockets.d.ts
│   ├── views
│   │   └── admin
│   │       ├── AdminLayout.tsx
│   │       ├── Analytics.tsx
│   │       ├── Announcements.tsx
│   │       ├── AuditLog.tsx
│   │       ├── BackgroundTasks.tsx
│   │       ├── ChatSessions.tsx
│   │       ├── Dashboard.tsx
│   │       ├── FeatureFlags.tsx
│   │       ├── Notifications.tsx
│   │       ├── Reports.tsx
│   │       ├── Subscriptions.tsx
│   │       ├── Support.tsx
│   │       ├── SystemSettings.tsx
│   │       └── Users.tsx
│   └── vite-env.d.ts
├── tsconfig.json
├── tsconfig.tsbuildinfo
├── vite.config.ts
└── vitest.config.ts
```

## File-format capabilities

See [docs/formats/README.md](docs/formats/README.md) for the audited inventory, conversion matrix, and verification status.
