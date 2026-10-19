import { createFileRoute } from "@tanstack/react-router";
import VerifyEmail from "@/pages/verify";

export const Route = createFileRoute("/auth/verify")({
  head: () => ({
    meta: [
      { title: "Verify your email — Vision" },
      { name: "description", content: "Enter the 8-digit code we emailed you to finish signing in to Vision." },
      { property: "og:title", content: "Verify your email — Vision" },
      { property: "og:description", content: "Enter your verification code to finish signing in to Vision." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VerifyEmail,
});
