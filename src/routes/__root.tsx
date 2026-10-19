import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { setupPwa } from "@/lib/pwa";
import { warmRoutes } from "@/lib/route-warmup";

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { RouteGuard } from "@/components/route-guard";
import { ChatHistoryProvider } from "@/context/ChatHistoryContext";
import appCss from "../styles.css?url";
import RouteError from "@/components/route-error";
import { AppMotion } from "@/components/app-motion";
import NavigationGestures from "@/components/navigation-gestures";
import OnboardingTutorial from "@/components/onboarding-tutorial";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      { title: "Vision" },
      { name: "description", content: "Vision — your all-in-one AI workspace." },
      { property: "og:title", content: "Vision" },
      { property: "og:description", content: "Vision — your all-in-one AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon-light.svg", media: "(prefers-color-scheme: light)" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon-dark.svg", media: "(prefers-color-scheme: dark)" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: RouteError,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Applies saved appearance settings before first paint to avoid a theme flash. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var p=JSON.parse(localStorage.getItem("vision_prefs")||"{}"),e=document.documentElement;if(p.theme==="dark"||p.theme==="light")e.classList.add(p.theme);if(p.accent)e.dataset.accent=p.accent;if(p.fontSize)e.dataset.fontSize=p.fontSize;if(p.reduceMotion)e.classList.add("reduce-motion");if(p.highContrast)e.classList.add("high-contrast");if(p.largeTargets)e.classList.add("large-targets")}catch(_){}` }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => { setupPwa(); }, []);
  useEffect(() => warmRoutes(router as never), [router]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <TooltipProvider>
        <AppMotion />
        <AuthProvider>
          <ChatHistoryProvider>
            <Toaster />
            <Sonner />
            <RouteGuard>
              <Outlet />
              <NavigationGestures />
              <OnboardingTutorial />
            </RouteGuard>
          </ChatHistoryProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
