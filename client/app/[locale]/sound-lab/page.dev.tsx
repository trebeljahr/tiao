import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "UI sound lab — Tiao",
  robots: { index: false, follow: false },
};

export default async function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  const { SoundLabPage } = await import("@/views/SoundLabPage");
  return <SoundLabPage />;
}
