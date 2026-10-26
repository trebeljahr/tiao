"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../../messages/es.json";

export default function SpanishProvider(props: {
  children: ReactNode;
  now: Date;
  timeZone: string;
}) {
  return <NextIntlClientProvider {...props} locale="es" messages={messages} />;
}
