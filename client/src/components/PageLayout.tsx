"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { Navbar } from "@/components/Navbar";
import { cn } from "@/lib/utils";

/**
 * Shared page layout: background gradient + navbar + main content area.
 * Eliminates the repeated boilerplate across all page views.
 */
export function PageLayout({
  children,
  maxWidth = "max-w-5xl",
  mainClassName,
}: {
  children: React.ReactNode;
  maxWidth?: string;
  mainClassName?: string;
}) {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />

      <main
        className={cn(
          "mx-auto flex flex-col gap-5 px-4 pb-5 pt-20 sm:px-6 lg:px-8 lg:pb-6 lg:pt-20",
          maxWidth,
          mainClassName,
        )}
      >
        {children}
      </main>
    </div>
  );
}
