"use client";

import type { ReactNode } from "react";
import { CreatorPage } from "@/views/CreatorPage";

const linkClass =
  "font-medium text-[#5d4732] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#3a2818]";

export default function Page() {
  return (
    <CreatorPage
      name="Rico Trebeljahr"
      username="ricotrebeljahr"
      image="/creators/rico.jpeg"
      roleKey="ricoRole"
      bioKey="ricoBio"
      bioTags={{
        liveAndLearn: (chunks: ReactNode) => (
          <a
            href="https://ricos.site/sub"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {chunks}
          </a>
        ),
        fractalGarden: (chunks: ReactNode) => (
          <a
            href="https://fractal.garden"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {chunks}
          </a>
        ),
      }}
      links={[
        { label: "Website", href: "https://ricos.site" },
        { label: "LinkedIn", href: "https://www.linkedin.com/in/trebeljahr/" },
        { label: "GitHub", href: "https://github.com/trebeljahr" },
      ]}
    />
  );
}
