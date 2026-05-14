import type { Metadata } from "next";
import { Suspense } from "react";
import { NO_INDEX_ROBOTS } from "@/lib/metadata";
import { ResetPasswordPage } from "@/views/ResetPasswordPage";

export const metadata: Metadata = {
  title: "Reset password",
  robots: NO_INDEX_ROBOTS,
};

export default function Page() {
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}
