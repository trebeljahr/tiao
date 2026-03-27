import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import type { MultiplayerSnapshot, TimeControl } from "@shared";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";
import { HourglassSpinner } from "@/components/game/GameShared";
import { useMatchmakingData } from "@/lib/hooks/useMatchmakingData";

export function MatchmakingPage() {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationTimeControl: TimeControl | null = (() => {
    const initial = searchParams?.get("initial");
    const increment = searchParams?.get("increment");
    if (initial && increment) {
      return { initialMs: Number(initial), incrementMs: Number(increment) };
    }
    return null;
  })();
  const [navOpen, setNavOpen] = useState(false);
  const cancelledRef = useRef(false);

  const onMatched = useCallback((snapshot: MultiplayerSnapshot) => {
    router.push(`/game/${snapshot.gameId}`);
  }, [router]);

  const {
    matchmaking,
    matchmakingBusy,
    handleEnterMatchmaking,
    handleCancelMatchmaking,
  } = useMatchmakingData(auth, onMatched);

  useEffect(() => {
    if (auth && matchmaking.status === "idle" && !matchmakingBusy && !cancelledRef.current) {
      void handleEnterMatchmaking(locationTimeControl);
    }
  }, [auth, matchmaking.status, matchmakingBusy, handleEnterMatchmaking, locationTimeControl]);

  const paperCard =
    "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[18rem] bg-[radial-gradient(circle_at_top,_rgba(255,247,231,0.76),_transparent_58%)]" />

      <Navbar
        mode="lobby"
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <Card className={paperCard}>
            <CardHeader className="text-center">
              <CardTitle className="text-4xl text-[#2b1e14]">Matchmaking</CardTitle>
              <CardDescription className="text-[#6e5b48]">
                Find an opponent online and start building your game history.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 flex flex-col items-center py-8">
              {!auth ? (
                <div className="w-full space-y-4 text-center">
                  <p className="text-[#6e5b48]">
                    Please sign in to enter the global matchmaking queue.
                  </p>
                  <Button
                    size="lg"
                    className="w-full h-16 text-xl"
                    onClick={() => onOpenAuth("login")}
                  >
                    Sign In
                  </Button>
                </div>
              ) : matchmaking.status === "searching" || matchmakingBusy ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <HourglassSpinner className="h-16 w-16 text-[#a6824d]" />
                    <motion.div
                      className="absolute inset-0 rounded-full border-4 border-[#a6824d]/20"
                      animate={{ scale: [1, 1.2, 1], opacity: [1, 0, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  </div>
                  <p className="text-lg font-semibold text-[#5d4732]">Searching for opponent...</p>
                  <p
                    className="text-sm text-[#7a6656]"
                    title={
                      locationTimeControl
                        ? `${Math.floor(locationTimeControl.initialMs / 60000)} min per player${locationTimeControl.incrementMs > 0 ? ` + ${Math.floor(locationTimeControl.incrementMs / 1000)}s added per move` : ", no increment"}`
                        : "No time limit"
                    }
                  >
                    {locationTimeControl
                      ? `${Math.floor(locationTimeControl.initialMs / 60000)}+${Math.floor(locationTimeControl.incrementMs / 1000)}`
                      : "Unlimited"}
                  </p>
                  <Button
                    variant="outline"
                    onClick={async () => { cancelledRef.current = true; await handleCancelMatchmaking(); router.push("/"); }}
                    disabled={matchmakingBusy}
                  >
                    Cancel Search
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <HourglassSpinner className="h-16 w-16 text-[#a6824d] opacity-50" />
                  <p className="text-[#6e5b48]">Initializing matchmaking...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}
