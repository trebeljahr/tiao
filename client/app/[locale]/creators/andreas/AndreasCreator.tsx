"use client";

import type { ReactNode } from "react";
import { CreatorPage } from "@/views/CreatorPage";

const linkClass =
  "font-medium text-[#5d4732] underline decoration-[#d4c4a8] underline-offset-2 hover:text-[#3a2818]";

export default function AndreasCreator() {
  return (
    <CreatorPage
      name="Andreas Edmeier"
      playerId={process.env.NEXT_PUBLIC_CREATOR_ANDREAS_ID}
      fallbackUsername="assertores"
      image="/creators/andreas.jpeg"
      roleKey="andreasRole"
      bioKey="andreasBio"
      bioTags={{
        nexus: (chunks: ReactNode) => (
          <a
            href="https://www.ubisoft.com/en-us/game/assassins-creed/nexus-vr"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {chunks}
          </a>
        ),
        avatar: (chunks: ReactNode) => (
          <a
            href="https://www.ubisoft.com/en-us/game/avatar/frontiers-of-pandora"
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            {chunks}
          </a>
        ),
      }}
      links={[
        { label: "Website", href: "https://www.assertores.me/" },
        { label: "LinkedIn", href: "https://www.linkedin.com/in/andreas-edmeier/" },
        { label: "GitHub", href: "https://github.com/Assertores" },
      ]}
    />
  );
}
