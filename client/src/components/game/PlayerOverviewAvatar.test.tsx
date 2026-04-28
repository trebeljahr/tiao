import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayerOverviewAvatar } from "./GameShared";

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => (
      <div {...filterDomProps(props)}>{children as React.ReactNode}</div>
    ),
    p: ({ children, ...props }: Record<string, unknown>) => (
      <p {...filterDomProps(props)}>{children as React.ReactNode}</p>
    ),
    button: ({ children, ...props }: Record<string, unknown>) => (
      <button {...filterDomProps(props)}>{children as React.ReactNode}</button>
    ),
    svg: ({ children, ...props }: Record<string, unknown>) => (
      <svg aria-hidden="true" {...filterDomProps(props)}>
        {children as React.ReactNode}
      </svg>
    ),
  },
  useAnimationControls: () => ({
    start: vi.fn(),
    set: vi.fn(),
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

function filterDomProps(props: Record<string, unknown>) {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
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
        "style",
      ].includes(key)
    ) {
      filtered[key] = value;
    }
  }
  return filtered;
}

describe("PlayerOverviewAvatar", () => {
  it("renders an img tag when profilePicture is provided", () => {
    render(
      <PlayerOverviewAvatar
        player={{
          displayName: "sso-user",
          profilePicture: "https://avatars.githubusercontent.com/u/12345",
        }}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://avatars.githubusercontent.com/u/12345");
    expect(img).toHaveAttribute("alt", "sso-user");
  });

  it("renders an img tag for SSO profile pictures from Google", () => {
    render(
      <PlayerOverviewAvatar
        player={{
          displayName: "google-user",
          profilePicture: "https://lh3.googleusercontent.com/a/some-avatar-id",
        }}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/some-avatar-id");
  });

  it("renders an img tag for SSO profile pictures from Discord", () => {
    render(
      <PlayerOverviewAvatar
        player={{
          displayName: "discord-user",
          profilePicture: "https://cdn.discordapp.com/avatars/123/abc.png",
        }}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://cdn.discordapp.com/avatars/123/abc.png");
  });

  it("renders initials fallback when no profilePicture is set", () => {
    const { container } = render(<PlayerOverviewAvatar player={{ displayName: "testuser" }} />);

    // No img tag should be present
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // Should show the first letter as initial
    expect(container.textContent).toBe("T");
  });

  it("renders initials fallback after image load error", () => {
    const { container } = render(
      <PlayerOverviewAvatar
        player={{
          displayName: "broken-user",
          profilePicture: "https://example.com/broken.jpg",
        }}
      />,
    );

    const img = screen.getByRole("img");
    fireEvent.error(img);

    // After error, should fall back to initial
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.textContent).toBe("B");
  });

  it("renders anonymous avatar when anonymous flag is set and no picture", () => {
    const { container } = render(
      <PlayerOverviewAvatar player={{ displayName: "anon" }} anonymous={true} />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // Anonymous avatar uses a silhouette icon, not text initials
    expect(container.textContent).toBe("");
  });

  it("prefers profilePicture over anonymous avatar", () => {
    render(
      <PlayerOverviewAvatar
        player={{
          displayName: "anon-with-pic",
          profilePicture: "https://example.com/avatar.jpg",
        }}
        anonymous={true}
      />,
    );

    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
  });

  it("renders ? initial when displayName is undefined and no picture", () => {
    const { container } = render(<PlayerOverviewAvatar player={{}} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.textContent).toBe("?");
  });
});
