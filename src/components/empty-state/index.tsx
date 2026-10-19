import type { AITool } from "@/lib/types";
import { AppLogo } from "@/components/app-logo";

type Props = {
  tool?: AITool;
};

const EmptyState = ({ tool }: Props) => (
  <div className="flex min-h-full flex-col items-center justify-center px-5 py-10 animate-fade-up">
    <AppLogo className="mb-5 size-14 shrink-0 rounded-full object-cover ring-1 ring-border" />
    <h2 className="text-center font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
      {tool?.emptyStateTitle || "What can I help you with?"}
    </h2>
  </div>
);

export default EmptyState;
