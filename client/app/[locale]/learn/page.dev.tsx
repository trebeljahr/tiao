import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Learn",
  robots: { index: false, follow: false },
};

export default async function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { LearningPage } = await import("@/views/LearningPage");
  return <LearningPage />;
}
