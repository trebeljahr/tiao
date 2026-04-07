"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import type { AuthResponse } from "@shared";
import { CardHeader, CardContent } from "@/components/ui/card";
import { PaperCard } from "@/components/ui/paper-card";

function PageSkeleton() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top,rgba(255,247,231,0.76),transparent_58%)]" />

      {/* Navbar placeholder */}
      <div className="flex h-14 items-center px-4 animate-pulse">
        <div className="h-8 w-8 rounded-lg bg-[#e8dcc8]" />
      </div>

      {/* Content skeleton */}
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 pb-12 pt-8 sm:px-6 lg:px-8 animate-pulse">
        <div className="h-8 w-48 rounded-lg bg-[#e8dcc8]" />
        <PaperCard className="overflow-hidden shadow-lg">
          <CardHeader className="border-b border-black/5 bg-black/2 py-4">
            <div className="h-7 w-32 rounded-lg bg-[#e8dcc8]" />
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-2xl border border-[#dcc7a2] bg-[#fffdf7] p-4"
              >
                <div className="flex flex-col gap-2">
                  <div className="h-5 w-24 rounded-sm bg-[#e8dcc8]" />
                  <div className="h-3.5 w-40 rounded-sm bg-[#ede3d2]" />
                </div>
                <div className="h-8 w-16 rounded-lg bg-[#e8dcc8]" />
              </div>
            ))}
          </CardContent>
        </PaperCard>
      </main>
    </div>
  );
}

/**
 * Wraps account-only pages. Shows a skeleton while auth loads,
 * redirects guests to "/", and renders children with guaranteed auth.
 */
export function RequireAccount({
  children,
}: {
  children: (auth: AuthResponse) => React.ReactNode;
}) {
  const { auth, authLoading } = useAuth();
  const router = useRouter();

  const isAccount = auth?.player.kind === "account";

  useEffect(() => {
    if (!authLoading && !isAccount) {
      router.replace("/");
    }
  }, [authLoading, isAccount, router]);

  if (authLoading) {
    return <PageSkeleton />;
  }

  if (!auth || !isAccount) {
    return null;
  }

  return <>{children(auth)}</>;
}
