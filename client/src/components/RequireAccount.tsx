"use client";

import type { AuthResponse } from "@shared";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SkeletonPage } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/AuthContext";

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
      router.replace("/play");
    }
  }, [authLoading, isAccount, router]);

  if (authLoading) {
    return <SkeletonPage />;
  }

  if (!auth || !isAccount) {
    return null;
  }

  return <>{children(auth)}</>;
}
