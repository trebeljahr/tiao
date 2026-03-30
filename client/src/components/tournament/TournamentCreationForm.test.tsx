import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TournamentCreationForm } from "./TournamentCreationForm";

// Mock Dialog to render children directly when open
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
    title,
    description,
  }: {
    open: boolean;
    children: React.ReactNode;
    title: string;
    description?: string;
  }) =>
    open ? (
      <div data-testid="dialog">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </div>
    ) : null,
}));

describe("TournamentCreationForm", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    busy: false,
  };

  it("renders nothing when closed", () => {
    render(<TournamentCreationForm {...defaultProps} open={false} />);
    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog with title when open", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    expect(screen.getByText("Create Tournament")).toBeInTheDocument();
  });

  // Step 0: Format selection
  it("shows format selection on step 0", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    expect(screen.getByText("Format")).toBeInTheDocument();
    expect(screen.getByText("Round Robin")).toBeInTheDocument();
    expect(screen.getByText("Single Elimination")).toBeInTheDocument();
    expect(screen.getByText("Groups + Knockout")).toBeInTheDocument();
  });

  it("shows format descriptions", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    expect(
      screen.getByText("Everyone plays everyone. Best for small groups (4-12 players)."),
    ).toBeInTheDocument();
    expect(screen.getByText("Lose once and you're out. Quick and dramatic.")).toBeInTheDocument();
  });

  it("shows Next button on step 0", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  // Step navigation
  it("advances to step 1 when Next is clicked", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next"));
    // Step 1 shows time control and max players
    expect(screen.getByText("Time Control")).toBeInTheDocument();
    expect(screen.getByText("Max players")).toBeInTheDocument();
  });

  it("goes back from step 1 to step 0", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Format")).toBeInTheDocument();
  });

  it("advances to step 2 from step 1", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next")); // step 0 -> 1
    fireEvent.click(screen.getByText("Next")); // step 1 -> 2
    expect(screen.getByText("Tournament name")).toBeInTheDocument();
    expect(screen.getByText("Description (optional)")).toBeInTheDocument();
  });

  // Step 1: Settings
  it("shows max player options on step 1", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("16")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    expect(screen.getByText("64")).toBeInTheDocument();
  });

  it("shows group size option only for groups-knockout format", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    // Select groups-knockout format
    fireEvent.click(screen.getByText("Groups + Knockout"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Group size")).toBeInTheDocument();
  });

  it("does not show group size for single-elimination format", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    // Default is single-elimination, just go to step 1
    fireEvent.click(screen.getByText("Next"));
    expect(screen.queryByText("Group size")).not.toBeInTheDocument();
  });

  // Step 2: Name, description, visibility
  it("shows visibility options on step 2", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("shows invite code field when Private is selected", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    fireEvent.click(screen.getByText("Private"));
    expect(screen.getByText("Invite code")).toBeInTheDocument();
  });

  it("does not show invite code field when Public is selected", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    // Public is default
    expect(screen.queryByText("Invite code")).not.toBeInTheDocument();
  });

  it("disables Create Tournament button when name is empty", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    const createBtn = screen.getByRole("button", { name: "Create Tournament" });
    expect(createBtn).toBeDisabled();
  });

  it("enables Create Tournament button when name is filled", () => {
    render(<TournamentCreationForm {...defaultProps} />);
    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "Test Cup" },
    });
    const createBtn = screen.getByRole("button", { name: "Create Tournament" });
    expect(createBtn).not.toBeDisabled();
  });

  it("disables Create Tournament button when busy", () => {
    render(<TournamentCreationForm {...defaultProps} busy={true} />);
    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "Test Cup" },
    });
    // When busy, button text changes to "Creating..."
    const createBtn = screen.getByText("Creating...");
    expect(createBtn).toBeDisabled();
  });

  it("calls onSubmit with correct data on form submission", () => {
    const onSubmit = vi.fn();
    render(<TournamentCreationForm {...defaultProps} onSubmit={onSubmit} />);

    // Step 0: select format (keep default single-elimination)
    fireEvent.click(screen.getByText("Next"));

    // Step 1: keep defaults
    fireEvent.click(screen.getByText("Next"));

    // Step 2: fill name and submit
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "My Cup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Tournament" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const call = onSubmit.mock.calls[0][0];
    expect(call.name).toBe("My Cup");
    expect(call.settings.format).toBe("single-elimination");
    expect(call.settings.visibility).toBe("public");
    expect(call.settings.maxPlayers).toBe(8);
  });

  it("includes description when provided", () => {
    const onSubmit = vi.fn();
    render(<TournamentCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "My Cup" },
    });
    fireEvent.change(screen.getByPlaceholderText("A friendly competition..."), {
      target: { value: "Fun times" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Tournament" }));

    const call = onSubmit.mock.calls[0][0];
    expect(call.description).toBe("Fun times");
  });

  it("omits description when empty", () => {
    const onSubmit = vi.fn();
    render(<TournamentCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "My Cup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Tournament" }));

    const call = onSubmit.mock.calls[0][0];
    expect(call.description).toBeUndefined();
  });

  it("includes inviteCode for private tournaments", () => {
    const onSubmit = vi.fn();
    render(<TournamentCreationForm {...defaultProps} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText("Next")); // 0 -> 1
    fireEvent.click(screen.getByText("Next")); // 1 -> 2
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "Private Cup" },
    });
    fireEvent.click(screen.getByText("Private"));
    fireEvent.change(screen.getByPlaceholderText("secret123"), {
      target: { value: "mycode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Tournament" }));

    const call = onSubmit.mock.calls[0][0];
    expect(call.settings.visibility).toBe("private");
    expect(call.settings.inviteCode).toBe("mycode");
  });

  it("includes groupSize for groups-knockout format", () => {
    const onSubmit = vi.fn();
    render(<TournamentCreationForm {...defaultProps} onSubmit={onSubmit} />);

    // Step 0: select groups-knockout
    fireEvent.click(screen.getByText("Groups + Knockout"));
    fireEvent.click(screen.getByText("Next"));

    // Step 1: keep defaults (groupSize=4 default)
    fireEvent.click(screen.getByText("Next"));

    // Step 2: fill name and submit
    fireEvent.change(screen.getByPlaceholderText("My Tournament"), {
      target: { value: "Group Cup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Tournament" }));

    const call = onSubmit.mock.calls[0][0];
    expect(call.settings.format).toBe("groups-knockout");
    expect(call.settings.groupSize).toBe(4);
  });
});
