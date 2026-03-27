import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";
import apiSidebar from "./docs/api-reference/sidebar";

const sidebars: SidebarsConfig = {
  docs: [
    "introduction",
    "game-rules",
    "architecture",
    {
      type: "category",
      label: "Guides",
      items: ["contributing", "issues-and-labels", "testing", "deployment"],
    },
    {
      type: "category",
      label: "Game Engine",
      items: ["game-engine/overview"],
    },
  ],
  api: [
    {
      type: "category",
      label: "API Reference",
      link: {
        type: "generated-index",
        title: "Tiao API Reference",
        description: "Complete REST API and WebSocket protocol reference.",
        slug: "/api-reference",
      },
      items: apiSidebar,
    },
  ],
};

export default sidebars;
