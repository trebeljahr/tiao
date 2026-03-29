import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("applies custom background classes without being overridden by defaults", () => {
    const { container } = render(<Badge className="bg-[#2d6a1e] text-white">Won</Badge>);
    const el = container.firstElementChild!;
    const classes = el.className;

    // The custom bg should be present
    expect(classes).toContain("bg-[#2d6a1e]");
    // The default bg should NOT appear alongside the custom one
    // (tw-merge should deduplicate, but we also verify the default isn't white)
    expect(classes).not.toContain("bg-white");
  });

  it("applies red background for lost badge", () => {
    const { container } = render(<Badge className="bg-[#9b2c2c] text-white">Lost</Badge>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-[#9b2c2c]");
    expect(el.className).not.toContain("bg-white");
  });

  it("uses default background when no bg class provided", () => {
    const { container } = render(<Badge>Status</Badge>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-[#f0e6d4]");
  });

  it("renders outline variant without background fill", () => {
    const { container } = render(<Badge variant="outline">Tag</Badge>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-transparent");
  });
});
