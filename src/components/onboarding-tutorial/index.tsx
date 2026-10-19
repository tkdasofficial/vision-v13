import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { gestureSurface } from "@/lib/navigation-motion";
import { GESTURE_STEPS, shouldShowTutorial, tutorialKey } from "@/lib/usage-guide";

/** Short first-run walkthrough of the navigation gestures, shown once after sign-up. */
export default function OnboardingTutorial() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!user || gestureSurface(pathname) !== "chat") return;
    let seen = true;
    try { seen = localStorage.getItem(tutorialKey(user.id)) === "1"; } catch { /* storage blocked */ }
    if (shouldShowTutorial(user, seen)) { setStep(0); setOpen(true); }
  }, [user, pathname]);
  const close = () => {
    if (user) try { localStorage.setItem(tutorialKey(user.id), "1"); } catch { /* ignore */ }
    setOpen(false);
  };
  const current = GESTURE_STEPS[step];
  const last = step === GESTURE_STEPS.length - 1;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className="max-w-sm">
      <p className="text-xs font-medium text-muted-foreground">Step {step + 1} of {GESTURE_STEPS.length}</p>
      <DialogTitle className="font-display text-xl">{current.title}</DialogTitle>
      <DialogDescription>{current.body}</DialogDescription>
      <div className="flex gap-1.5" aria-hidden="true">
        {GESTURE_STEPS.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />)}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button variant="ghost" asChild><Link to="/guide" onClick={close}>Full guide</Link></Button>
        <div className="flex gap-2">
          {step > 0 && <Button variant="outline" onClick={() => setStep(step - 1)}>Back</Button>}
          <Button onClick={() => (last ? close() : setStep(step + 1))}>{last ? "Get started" : "Next"}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}
