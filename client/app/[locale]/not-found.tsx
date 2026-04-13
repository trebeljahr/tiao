"use client";

import { PageLayout } from "@/components/PageLayout";
import { NotFoundPage } from "@/views/NotFoundPage";

export default function NotFound() {
  return (
    <PageLayout maxWidth="max-w-lg">
      <NotFoundPage />
    </PageLayout>
  );
}
