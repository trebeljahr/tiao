import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberStepper } from "./number-stepper";

const defaultProps = {
  value: 5,
  onChange: vi.fn(),
  label: "Duration",
  unit: "min",
};

describe("NumberStepper", () => {
  it("renders without crashing", () => {
    render(<NumberStepper {...defaultProps} />);
    expect(screen.getByText("Duration")).toBeInTheDocument();
  });

  it("displays the label and unit", () => {
    render(<NumberStepper {...defaultProps} />);
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("min")).toBeInTheDocument();
  });

  it("displays the current value in the input", () => {
    render(<NumberStepper {...defaultProps} />);
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(5);
  });

  it("calls onChange with decremented value when decrease is clicked", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Decrease Duration" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("calls onChange with incremented value when increase is clicked", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Increase Duration" }));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("respects custom step value", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} onChange={onChange} step={5} />);

    fireEvent.click(screen.getByRole("button", { name: "Increase Duration" }));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("disables decrease button when value is at min", () => {
    render(<NumberStepper {...defaultProps} value={0} min={0} />);
    expect(screen.getByRole("button", { name: "Decrease Duration" })).toBeDisabled();
  });

  it("disables increase button when value is at max", () => {
    render(<NumberStepper {...defaultProps} value={10} max={10} />);
    expect(screen.getByRole("button", { name: "Increase Duration" })).toBeDisabled();
  });

  it("clamps value to min when decreasing below min", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} value={1} min={0} step={5} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Decrease Duration" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("clamps value to max when increasing above max", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} value={8} max={10} step={5} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Increase Duration" }));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("calls onChange when user types a valid number in the input", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("clamps typed values to the max", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} max={50} onChange={onChange} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "99" } });
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it("does not call onChange for non-numeric input", () => {
    const onChange = vi.fn();
    render(<NumberStepper {...defaultProps} onChange={onChange} />);

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses default min of 0 and max of 999", () => {
    const { unmount } = render(<NumberStepper {...defaultProps} value={0} />);
    expect(screen.getByRole("button", { name: "Decrease Duration" })).toBeDisabled();
    unmount();

    render(<NumberStepper {...defaultProps} value={999} />);
    expect(screen.getByRole("button", { name: "Increase Duration" })).toBeDisabled();
  });
});
