import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import confetti from "canvas-confetti";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { markTutorialComplete } from "@/lib/api";
import { cn } from "@/lib/utils";
import { InteractiveMiniBoard } from "@/components/tutorial/InteractiveMiniBoard";
import { TUTORIAL_STEPS } from "@/components/tutorial/tutorialSteps";


function fireBigConfetti() {
  const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#ff9ff3", "#54a0ff", "#5f27cd", "#01a3a4", "#f368e0", "#ff9f43", "#00d2d3"];

  // Big initial burst from center
  confetti({
    particleCount: 120,
    startVelocity: 45,
    spread: 360,
    origin: { x: 0.5, y: 0.4 },
    colors,
    scalar: 1.2,
    gravity: 0.6,
    ticks: 200,
    shapes: ["circle", "square"],
  });

}

// --- Progress dots ---

function ProgressDots({
  total,
  current,
  completedSteps,
  onDotClick,
}: {
  total: number;
  current: number;
  completedSteps: Set<number>;
  onDotClick: (index: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <button
          key={i}
          onClick={() => onDotClick(i)}
          className={cn(
            "h-2.5 rounded-full transition-all duration-300",
            i === current
              ? completedSteps.has(i)
                ? "w-8 bg-[#8db87a]"
                : "w-8 bg-[#b98d49]"
              : completedSteps.has(i)
                ? "w-2.5 bg-[#8db87a] hover:bg-[#6e9a5f]"
                : "w-2.5 bg-[#e8dcc8] hover:bg-[#d7c39e]",
          )}
          aria-label={`Go to step ${i + 1}`}
        />
      ))}
    </div>
  );
}

// --- Main tutorial component ---

export function TutorialPage() {
  const { auth, applyAuth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [completing, setCompleting] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(
    new Set(),
  );
  const [resetKeys, setResetKeys] = useState<number[]>(
    () => TUTORIAL_STEPS.map(() => 0),
  );

  const step = TUTORIAL_STEPS[currentStep];
  const isLastStep = currentStep === TUTORIAL_STEPS.length - 1;
  const isInteractive = !!step.board;
  const isStepDone = completedSteps.has(currentStep);

  const goTo = useCallback(
    (index: number) => {
      if (index === currentStep) return;
      setDirection(index > currentStep ? 1 : -1);
      setCurrentStep(index);
      // Reset the board when navigating to an interactive step (for visual replay)
      if (TUTORIAL_STEPS[index].board) {
        setResetKeys((prev) => {
          const next = [...prev];
          next[index] = prev[index] + 1;
          return next;
        });
      }
    },
    [currentStep],
  );

  const goNext = useCallback(() => {
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      // Mark current step as completed when advancing
      setCompletedSteps((prev) => new Set(prev).add(currentStep));
      goTo(currentStep + 1);
    }
  }, [currentStep, goTo]);

  const goPrev = useCallback(() => {
    if (currentStep > 0) {
      goTo(currentStep - 1);
    }
  }, [currentStep, goTo]);

  function handleStepComplete() {
    setCompletedSteps((prev) => new Set(prev).add(currentStep));
    // Auto-advance after a short delay
    setTimeout(() => {
      if (currentStep < TUTORIAL_STEPS.length - 1) {
        goTo(currentStep + 1);
      }
    }, 900);
  }

  const isReplay = auth?.player.kind === "account" && auth.player.hasSeenTutorial;

  async function handleFinish() {
    setCompleting(true);
    fireBigConfetti();

    localStorage.setItem("tiao:tutorialComplete", "1");

    if (auth?.player.kind === "account" && !isReplay) {
      try {
        const result = await markTutorialComplete();
        applyAuth(result.auth);
      } catch {
        // Non-critical
      }
    }

    await new Promise((r) => setTimeout(r, 1200));
    router.push("/");
  }

  async function handleSkip() {
    localStorage.setItem("tiao:tutorialComplete", "1");

    if (auth?.player.kind === "account" && !isReplay) {
      try {
        const result = await markTutorialComplete();
        applyAuth(result.auth);
      } catch {
        // Non-critical
      }
    }

    router.push("/");
  }

  // Keyboard navigation
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        // Only advance if step is non-interactive or completed
        if (!isInteractive || isStepDone) {
          if (!isLastStep) goNext();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev, isLastStep, isInteractive, isStepDone]);

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
  };

  // Can the user advance?
  const canAdvance = !isInteractive || isStepDone;

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-background px-4 py-8">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[24rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="tutorial"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <div className="flex w-full max-w-lg flex-col items-center gap-5">
        {/* Step counter */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3"
        >
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#8d7760]">
            {currentStep + 1} / {TUTORIAL_STEPS.length}
          </span>
        </motion.div>

        {/* Animated step content */}
        <div className="w-full">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step.id}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: "easeInOut" }}
            >
              <div className="rounded-3xl border border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.97),rgba(244,231,207,0.95))] p-5 sm:p-7 shadow-xl">
                <h2 className="mb-4 text-center font-display text-3xl tracking-tight text-[#2b1e14]">
                  {step.title}
                </h2>

                {/* Description text */}
                <div className="mb-4">{step.description}</div>

                {/* Interactive board */}
                {step.board && (
                  <div className="mt-4">
                    <InteractiveMiniBoard
                      config={step.board}
                      onComplete={handleStepComplete}
                      active={true}
                      resetKey={resetKeys[currentStep]}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress dots */}
        <ProgressDots
          total={TUTORIAL_STEPS.length}
          current={currentStep}
          completedSteps={completedSteps}
          onDotClick={goTo}
        />

        {/* Navigation */}
        <div className="flex w-full items-center justify-between gap-3">
          <Button
            variant="ghost"
            className="text-[#8d7760] hover:text-[#5d4732]"
            onClick={goPrev}
            disabled={currentStep === 0}
          >
            ← Back
          </Button>

          <div className="flex items-center gap-2">
            {!isLastStep && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-[#a08d78] hover:text-[#6e5b48]"
                onClick={handleSkip}
              >
                Skip
              </Button>
            )}

            {isLastStep ? (
              <Button
                size="lg"
                className="min-w-[180px] h-14 text-lg shadow-lg bg-[linear-gradient(180deg,#4b3726,#2b1e14)] hover:shadow-xl transition-all"
                onClick={handleFinish}
                disabled={completing}
              >
                {completing ? "Let's go!" : "Return to lobby →"}
              </Button>
            ) : canAdvance ? (
              <Button
                size="lg"
                className="min-w-[120px] h-12 shadow-md bg-[linear-gradient(180deg,#4b3726,#2b1e14)] hover:shadow-lg transition-all"
                onClick={goNext}
              >
                Next →
              </Button>
            ) : (
              <span className="text-xs text-[#a08d78] italic">
                Complete the challenge ↑
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
