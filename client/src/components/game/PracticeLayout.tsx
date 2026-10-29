"use client";

import { type ReactNode, useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/lib/AuthContext";
import { cn } from "@/lib/utils";

export function PracticeLayout({
  learning = false,
  children,
}: {
  learning?: boolean;
  children: ReactNode;
}) {
  const { auth, onOpenAuth, onLogout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <Navbar
        auth={auth}
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((open) => !open)}
        onCloseNav={() => setNavOpen(false)}
        onOpenAuth={onOpenAuth}
        onLogout={onLogout}
      />
      <main className="mx-auto max-w-7xl px-4 pb-12 pt-20 sm:px-6 sm:pt-8">
        <div className="mb-6 flex items-center justify-between gap-3 border-b border-border">
          <nav aria-label="Practice sections" className="flex gap-6">
            {[
              { label: "Learn", href: "/learn", active: learning },
              { label: "Puzzles", href: "/puzzles", active: !learning },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={cn(
                  "border-b-2 py-4 font-display text-xl transition-colors",
                  item.active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="text-xs text-muted-foreground">Development only</span>
        </div>
        {children}
      </main>
    </div>
  );
}
