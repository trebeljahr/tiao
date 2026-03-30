import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  it("renders without crashing", () => {
    render(<PasswordInput />);
    expect(document.querySelector("input")).toBeInTheDocument();
  });

  it("renders as password type by default", () => {
    render(<PasswordInput />);
    const input = document.querySelector("input")!;
    expect(input.type).toBe("password");
  });

  it("has a toggle button with 'Show password' label initially", () => {
    render(<PasswordInput />);
    expect(screen.getByRole("button", { name: "Show password" })).toBeInTheDocument();
  });

  it("toggles to text type when visibility button is clicked", () => {
    render(<PasswordInput />);

    const input = document.querySelector("input")!;
    const toggle = screen.getByRole("button", { name: "Show password" });

    fireEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });

  it("toggles back to password type on second click", () => {
    render(<PasswordInput />);

    const input = document.querySelector("input")!;

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");

    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
  });

  it("passes placeholder prop to the underlying input", () => {
    render(<PasswordInput placeholder="Enter password" />);
    expect(screen.getByPlaceholderText("Enter password")).toBeInTheDocument();
  });

  it("applies custom className alongside default classes", () => {
    render(<PasswordInput className="my-custom" />);
    const input = document.querySelector("input")!;
    expect(input.className).toContain("my-custom");
    expect(input.className).toContain("pr-10");
  });

  it("forwards the disabled prop", () => {
    render(<PasswordInput disabled />);
    const input = document.querySelector("input")!;
    expect(input).toBeDisabled();
  });

  it("accepts user text input", () => {
    render(<PasswordInput />);
    const input = document.querySelector("input")!;

    fireEvent.change(input, { target: { value: "secret123" } });
    expect(input.value).toBe("secret123");
  });

  it("toggle button has tabIndex -1 to avoid tab focus", () => {
    render(<PasswordInput />);
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle.tabIndex).toBe(-1);
  });
});
