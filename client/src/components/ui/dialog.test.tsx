import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/* ---------- mock framer-motion ---------- */
function motionProxy(tag: string) {
  return ({ children, onClick, onMouseDown, className, ...rest }: Record<string, unknown>) => {
    const Tag = tag as keyof React.JSX.IntrinsicElements;
    const domProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (
        ![
          "initial",
          "animate",
          "exit",
          "transition",
          "variants",
          "whileHover",
          "whileTap",
          "layout",
          "layoutId",
        ].includes(key)
      ) {
        domProps[key] = value;
      }
    }
    return (
      <Tag
        onClick={onClick as React.MouseEventHandler}
        onMouseDown={onMouseDown as React.MouseEventHandler}
        className={className as string}
        {...domProps}
      >
        {children as React.ReactNode}
      </Tag>
    );
  };
}

vi.mock("framer-motion", () => {
  const handler = {
    get(_target: unknown, tag: string) {
      return motionProxy(tag);
    },
  };
  return {
    motion: new Proxy({}, handler),
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

/* ---------- tests ---------- */
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("closes when clicking the backdrop", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Test">
        <p>content</p>
      </Dialog>,
    );

    // The backdrop is the outermost motion.div (fixed inset-0)
    const backdrop = screen.getByText("content").parentElement!.parentElement!;
    fireEvent.mouseDown(backdrop, { target: backdrop, currentTarget: backdrop });
    fireEvent.click(backdrop, { target: backdrop, currentTarget: backdrop });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does NOT close when drag starts inside dialog and ends on backdrop", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Test">
        <input data-testid="input" defaultValue="hello" />
      </Dialog>,
    );

    const input = screen.getByTestId("input");
    const backdrop = input.closest(".fixed")!;

    // Simulate a drag: mousedown inside dialog content, then mouseup/click on backdrop
    fireEvent.mouseDown(input);
    // The click event fires on backdrop after drag
    fireEvent.click(backdrop, { target: backdrop, currentTarget: backdrop });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes when pressing Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Test">
        <p>content</p>
      </Dialog>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes via the x button", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Test">
        <p>content</p>
      </Dialog>,
    );

    // The close button is a circular icon button with an SVG X and an
    // aria-label resolved from common.close (the test i18n provider
    // exposes "Close" for that key).
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <Dialog open={false} onOpenChange={vi.fn()} title="Test">
        <p>content</p>
      </Dialog>,
    );

    expect(container.innerHTML).toBe("");
  });
});
