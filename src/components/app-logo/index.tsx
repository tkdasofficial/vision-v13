import { cn } from "@/lib/utils";
import lightLogo from "@/assets/logo-light.svg";
import darkLogo from "@/assets/logo-dark.svg";

interface AppLogoProps {
  className?: string;
  alt?: string;
}

/**
 * Theme-aware Vision logo: light theme shows the white/black mark,
 * dark theme shows the black/white mark. Swaps with CSS so it follows
 * both the app's theme setting and the system preference.
 */
export function AppLogo({ className, alt = "Vision" }: AppLogoProps) {
  return (
    <>
      <img src={lightLogo} alt={alt} className={cn(className, "dark:hidden")} />
      <img src={darkLogo} alt={alt} className={cn(className, "hidden dark:block")} />
    </>
  );
}
