import type { Metadata } from "next";
import AndreasCreator from "./AndreasCreator";

export const metadata: Metadata = {
  title: "Andreas Edmeier",
  description:
    "Andreas is the game designer and creator of Tiao. A game developer from Germany with a passion for board games and elegant mechanics.",
  openGraph: {
    title: "Andreas Edmeier -- Creator of Tiao",
    description:
      "Meet the mind behind Tiao. Game designer and developer with a passion for board games and elegant mechanics.",
  },
};

export default function Page() {
  return <AndreasCreator />;
}
