import { readFileSync } from "node:fs";
import path from "node:path";
import { ACHIEVEMENTS } from "@shared";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AchievementCard } from "./AchievementCard";
import { AchievementIcon } from "./AchievementIcon";

afterEach(cleanup);

describe("achievement artwork", () => {
  it.each(ACHIEVEMENTS)("loads bundled artwork for $id", (def) => {
    const { container } = render(<AchievementIcon id={def.id} tier={def.tier} />);
    const image = container.querySelector("img")!;
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    const bytes = readFileSync(path.join(process.cwd(), "public", image.getAttribute("src")!));
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  });

  it("uses grayscale for locked artwork and restores color after unlocking", () => {
    const { container, rerender } = render(
      <AchievementIcon id="first-move" tier="bronze" unlocked={false} />,
    );
    expect(container.querySelector("img")).toHaveClass("grayscale");
    rerender(<AchievementIcon id="first-move" tier="bronze" unlocked />);
    expect(container.querySelector("img")).not.toHaveClass("grayscale");
  });

  it("keeps secret artwork hidden until unlocked", () => {
    const secret = ACHIEVEMENTS.find((def) => def.secret)!;
    const { container, rerender } = render(<AchievementCard def={secret} unlocked={false} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("???");
    rerender(<AchievementCard def={secret} unlocked />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(container).not.toHaveTextContent("???");
  });

  it("keeps a trophy fallback for unrecognized achievement IDs", () => {
    const { container } = render(<AchievementIcon id="future-achievement" tier="gold" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
