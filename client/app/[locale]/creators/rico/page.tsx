import type { Metadata } from "next";
import RicoCreator from "./RicoCreator";

export const metadata: Metadata = {
  title: "Rico Trebeljahr",
  description:
    "Rico is the developer behind playtiao.com. Full-stack engineer based in Berlin who built the digital version of Tiao.",
  openGraph: {
    title: "Rico Trebeljahr -- Tiao Developer",
    description:
      "Meet the developer behind playtiao.com. Full-stack engineer and creator of the digital Tiao experience.",
  },
};

export default function Page() {
  return <RicoCreator />;
}
