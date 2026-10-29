import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Puzzles",
  robots: { index: false, follow: false },
};

export default async function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { PuzzlesPage } = await import("@/views/PuzzlesPage");
  return <PuzzlesPage />;
}
