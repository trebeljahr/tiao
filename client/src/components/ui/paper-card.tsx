import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PAPER_CARD_CLASSES =
  "border-[#d0bb94]/75 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(244,231,207,0.94))]";

export function PaperCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn(PAPER_CARD_CLASSES, className)} {...props} />;
}
