import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("blanks the placeholder while the password is revealed", () => {
    render(<PasswordInput placeholder="••••••••••••" />);
    const input = document.querySelector("input")!;
    expect(input.placeholder).toBe("••••••••••••");

    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(input.placeholder).toBe("");

    // Toggling back restores the original bullet hint
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
    expect(input.placeholder).toBe("••••••••••••");
  });

  it("blanks the placeholder when controlled visible prop is true", () => {
    const { rerender } = render(<PasswordInput placeholder="••••••••••••" visible={false} />);
    const input = document.querySelector("input")!;
    expect(input.placeholder).toBe("••••••••••••");

    rerender(<PasswordInput placeholder="••••••••••••" visible={true} />);
    expect(input.placeholder).toBe("");
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

  it("uses controlled visibility when visible prop is provided", () => {
    const onVisibilityChange = vi.fn();
    const { rerender } = render(
      <PasswordInput visible={false} onVisibilityChange={onVisibilityChange} />,
    );
    const input = document.querySelector("input")!;
    expect(input.type).toBe("password");

    // Clicking should call the callback but NOT toggle internally
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(onVisibilityChange).toHaveBeenCalledWith(true);
    expect(input.type).toBe("password"); // still password — controlled

    // Parent re-renders with visible=true
    rerender(<PasswordInput visible={true} onVisibilityChange={onVisibilityChange} />);
    expect(input.type).toBe("text");
  });
});
