"use client";

import { CreatorPage } from "@/views/CreatorPage";

export default function Page() {
  return (
    <CreatorPage
      name="Andreas Edmeier"
      username="Andreas Edmeier"
      image="/creators/andreas.jpg"
      role="Game Designer & Creator of Tiao"
      bio="Andreas is a game developer from Germany and the brilliant mind behind Tiao. With a passion for board games and game design, he created the original concept that became this digital adaptation. When he's not crafting elegant game mechanics, Andreas works as a C++ application programmer at Ubisoft, where he's contributed to titles like Assassin's Creed Nexus VR and Avatar: Frontiers of Pandora. He's also an astronomy and space flight nerd who plays drums and guitar."
      links={[
        { label: "Website", href: "https://www.assertores.me/" },
        { label: "LinkedIn", href: "https://www.linkedin.com/in/andreas-edmeier/" },
        { label: "GitHub", href: "https://github.com/Assertores" },
      ]}
    />
  );
}
