"use client";

import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import messages from "../../../messages/de.json";

export default function GermanProvider(props: {
  children: ReactNode;
  now: Date;
  timeZone: string;
}) {
  return <NextIntlClientProvider {...props} locale="de" messages={messages} />;
}
