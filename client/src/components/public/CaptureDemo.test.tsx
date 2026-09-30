import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CaptureDemo } from "./CaptureDemo";

describe("capture example", () => {
  it("explains each jump and lets the reader reset", () => {
    render(<CaptureDemo />);
    fireEvent.click(screen.getByRole("button", { name: /^Jump$/ }));
    expect(screen.getByText(/One capture is marked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Jump again$/ }));
    expect(screen.getByText(/Confirm the turn to remove both/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Start$/ }));
    expect(screen.getByRole("button", { name: /^Start$/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/White can jump over/)).toBeInTheDocument();
  });
});
