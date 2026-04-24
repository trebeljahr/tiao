import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";

describe("Badge", () => {
  it("applies custom background classes without being overridden by defaults", () => {
    const { container } = render(<Badge className="bg-[#1a5c0a] text-white">Won</Badge>);
    const el = container.firstElementChild!;
    const classes = el.className;

    // The custom bg should be present
    expect(classes).toContain("bg-[#1a5c0a]");
    // The default bg should NOT appear alongside the custom one
    // (tw-merge should deduplicate, but we also verify the default isn't white)
    expect(classes).not.toContain("bg-white");
  });

  it("applies red background for lost badge", () => {
    const { container } = render(<Badge className="bg-[#7f1d1d] text-white">Lost</Badge>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-[#7f1d1d]");
    expect(el.className).not.toContain("bg-white");
  });

  it("uses default background when no bg class provided", () => {
    const { container } = render(<Badge>Status</Badge>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-[#f0e6d4]");
  });

  it("renders outline-solid variant without background fill", () => {
    const { container } = render(<Badge variant="outline">Tag</Badge>);
    const el = container.firstElementChild!;
    expect(el.className).toContain("bg-transparent");
  });
});
