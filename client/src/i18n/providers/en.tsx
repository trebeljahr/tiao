"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../../messages/en.json";

export default function EnglishProvider(props: {
  children: ReactNode;
  now: Date;
  timeZone: string;
}) {
  return <NextIntlClientProvider {...props} locale="en" messages={messages} />;
}
