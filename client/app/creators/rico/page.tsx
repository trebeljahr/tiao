"use client";

import { CreatorPage } from "@/views/CreatorPage";

export default function Page() {
  return (
    <CreatorPage
      name="Rico Trebeljahr"
      username="ricotrebeljahr"
      image="/creators/rico.jpg"
      role="Developer of playtiao.com"
      bio="Rico is a full-stack software engineer based in Berlin who built this digital version of Tiao. He's passionate about crafting polished web experiences with a love for real-time multiplayer systems. Outside of coding, Rico writes a blog and newsletter called Live and Learn, creates mathematical art like Fractal Garden, and is always exploring new ideas at the intersection of technology and creativity."
      links={[
        { label: "Website", href: "https://ricos.site" },
        { label: "Portfolio", href: "https://portfolio.trebeljahr.com" },
        { label: "LinkedIn", href: "https://www.linkedin.com/in/trebeljahr/" },
      ]}
    />
  );
}
