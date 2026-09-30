import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntryRedirect } from "./EntryRedirect";

const { replace, session } = vi.hoisted(() => ({
  replace: vi.fn(),
  session: {
    auth: null as null | { player: { kind: string; needsUsername?: boolean } },
    authBootstrapped: false,
  },
}));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => session }));

describe("public entry", () => {
  beforeEach(() => {
    replace.mockClear();
    session.auth = null;
    session.authBootstrapped = false;
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "electron", { value: undefined, configurable: true });
  });

  it("keeps visitors and auto-created guests on the landing page", () => {
    const view = render(<EntryRedirect />);
    session.auth = { player: { kind: "guest" } };
    session.authBootstrapped = true;
    view.rerender(<EntryRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("waits for session verification before redirecting an account", () => {
    session.auth = { player: { kind: "account" } };
    const view = render(<EntryRedirect />);
    expect(replace).not.toHaveBeenCalled();
    session.authBootstrapped = true;
    view.rerender(<EntryRedirect />);
    expect(replace).toHaveBeenCalledWith("/play");
  });

  it("preserves query and hash when entering play", () => {
    window.history.replaceState({}, "", "/?source=friend#invitations");
    render(<EntryRedirect />);
    expect(replace).toHaveBeenCalledWith("/play?source=friend#invitations");
  });

  it("leaves incomplete accounts to the onboarding guard", () => {
    session.auth = { player: { kind: "account", needsUsername: true } };
    session.authBootstrapped = true;
    render(<EntryRedirect />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("opens play in the Electron runtime even without a session", () => {
    Object.defineProperty(window, "electron", { value: { isElectron: true }, configurable: true });
    render(<EntryRedirect />);
    expect(replace).toHaveBeenCalledWith("/play");
  });
});
