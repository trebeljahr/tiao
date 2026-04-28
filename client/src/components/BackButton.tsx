"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export function BackButton() {
  const router = useRouter();
  const t = useTranslations("common");

  return (
    <Button variant="ghost" className="self-start text-[#8b7356]" onClick={() => router.back()}>
      &larr; {t("back")}
    </Button>
  );
}
