import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NO_INDEX_ROBOTS } from "@/lib/metadata";

export const metadata: Metadata = {
  title: "Admin",
  robots: NO_INDEX_ROBOTS,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
