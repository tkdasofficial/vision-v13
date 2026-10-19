import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import RouteError from "@/components/route-error";
import { pageTransitionTypes } from "@/lib/app-motion";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultViewTransition: { types: pageTransitionTypes },
    // Errors stay inside the route that failed, so the rest of the screen (e.g. an open chat) stays put.
    defaultErrorComponent: RouteError,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
