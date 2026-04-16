import { expect, Page } from "@playwright/test";

/**
 * Wait for the page to be interactive. Most pages render the hamburger
 * nav button once React has hydrated; a handful (profile, settings,
 * onboarding) don't include the Navbar. Fall back to waiting for the
 * page's <main> element which is present on every layout.
 */
export async function waitForAppReady(page: Page) {
  await expect(page.locator('[aria-label="Open navigation"], main'))
    .first()
    .toBeVisible({ timeout: 30_000 });
}

/**
 * On mobile (touch) devices, Playwright's .tap() doesn't always generate the
 * synthetic click event that TiaoBoard's onClick handler relies on for piece
 * selection and jump execution. This helper first resets the touch-event
 * suppress guard, then dispatches a click so the React handler fires.
 */
export async function mobileClickCell(page: Page, x: number, y: number) {
  // Small delay to let any pending tap's click handler clear suppressClickRef
  await page.waitForTimeout(50);
  await page.evaluate(
    ([cx, cy]) => {
      const el = document.querySelector(`[data-testid="cell-${cx}-${cy}"]`) as HTMLButtonElement;
      el?.click();
    },
    [x, y],
  );
  // Let React process the state update
  await page.waitForTimeout(50);
}

/**
 * Dismiss the "Welcome to Tiao!" rules intro modal that appears on
 * multiplayer game pages for new users who haven't completed the tutorial.
 * Call this after navigating to a game page.
 */
export async function dismissRulesIntro(page: Page) {
  const dialog = page.locator("text=Welcome to Tiao!");
  if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.locator('button:has-text("Got it")').click();
    await expect(dialog).not.toBeVisible({ timeout: 2000 });
  }
}

/**
 * Create a test user via the fast /api/test-auth endpoint and set the
 * session cookie on the browser context. This bypasses the full UI signup
 * flow (which is tested separately in auth.spec.ts) and avoids the slow
 * auth bootstrap that causes flaky timeouts under parallel load.
 *
 * The endpoint also marks hasSeenTutorial=true so the rules intro modal
 * doesn't block game tests.
 */
export async function signUpViaAPI(page: Page, username: string, password: string, email?: string) {
  const testEmail = email || `${username}@test.tiao.local`;

  // Call the test-auth endpoint to create a user and get session token.
  // Give the request a 30s ceiling — better-auth's signup handler does
  // a few DB writes plus bcrypt hashing, which can take ~1s even on a
  // quiet test runner, and sometimes spikes under parallel load.
  const response = await page.request.post("/api/test-auth", {
    data: { username, password, email: testEmail },
    timeout: 30_000,
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`test-auth failed (${response.status()}): ${body}`);
  }

  // Navigate to the lobby and wait for the auth bootstrap to flip the
  // LobbyPage from its `isGuest` layout (disabled Create a game + login
  // CTA) to the authenticated layout. The guest version renders a
  // disabled placeholder with the same label, so tests that click
  // "Create a game" too eagerly race the auth fetch and hit the
  // disabled stub. Waiting for the enabled button (or the disappearance
  // of the "Log in or create an account" CTA text) is the reliable
  // "account session is live" signal.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await expect(
    page.getByText("Log in or create an account to create and join custom games."),
  ).toHaveCount(0, { timeout: 20_000 });
}

/**
 * Open the auth dialog in the given mode via the nav drawer.
 *
 * The nav drawer's Log in / Sign up buttons are always present for
 * guests and are the most reliable path — the lobby card CTA can
 * race with lazy-loaded React components and the dialog doesn't
 * always react to its clicks in time. Waits for the dialog heading
 * to render before returning so callers can fill fields without
 * racing the dialog mount.
 */
async function openAuthDialog(page: Page, mode: "login" | "signup") {
  const buttonName = mode === "signup" ? "Sign up" : "Log in";
  const dialogHeadingName = mode === "signup" ? "Create account" : "Log in";

  await page.click('[aria-label="Open navigation"]');
  // Retry the drawer-button click a few times — the AuthDialog is
  // lazy-loaded via next/dynamic(ssr:false), and the first click after
  // a cold page load can race the chunk fetch.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page
      .locator("aside")
      .getByRole("button", { name: new RegExp(`^${buttonName}$`) })
      .click({ timeout: 5_000 })
      .catch(() => undefined);

    const visible = await page
      .getByRole("heading", { name: dialogHeadingName })
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    if (visible) return;

    // Re-open the drawer if it closed without the dialog appearing
    // (e.g. the click landed but the onOpenAuth state update was
    // dropped). If the drawer is still open this is a no-op.
    if (
      !(await page
        .locator("aside")
        .isVisible({ timeout: 500 })
        .catch(() => false))
    ) {
      await page.click('[aria-label="Open navigation"]');
    }
  }

  await expect(page.getByRole("heading", { name: dialogHeadingName })).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Opens the auth dialog in signup mode, fills in the form, and submits.
 * Waits for the signup to settle by observing the auth dialog closing —
 * more reliable than waitForResponse, which raced with better-auth's
 * internal request chain. Use signUpViaAPI for faster non-auth tests.
 */
export async function signUpViaUI(page: Page, username: string, password: string, email?: string) {
  const testEmail = email || `${username}@test.tiao.local`;

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openAuthDialog(page, "signup");
  await page.fill("#signup-display-name", username);
  await page.fill("#signup-email", testEmail);
  await page.fill("#signup-new-password", password);
  await page.fill("#signup-confirm-new-password", password);
  await page.getByRole("button", { name: /Create account|Creating/ }).click();
  // The auth dialog closes when signup succeeds — use the heading that
  // only renders while the dialog is open as the "still busy" signal.
  await expect(page.getByRole("heading", { name: "Create account" })).toHaveCount(0, {
    timeout: 20_000,
  });
}

/**
 * Opens the auth dialog in login mode, fills in credentials, and submits.
 * Waits for the dialog to close rather than a specific response so the
 * helper is resilient to transport/redirect details.
 */
export async function signInViaUI(page: Page, usernameOrEmail: string, password: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await openAuthDialog(page, "login");
  await page.fill("#login-email", usernameOrEmail);
  await page.fill("#login-password", password);
  await page.locator("#tiao-login-form").getByRole("button", { name: "Log in" }).click();
  // Wait for the login dialog heading to disappear — happens on
  // successful login (applyAuth → setAuthDialogOpen(false)).
  await expect(page.getByRole("heading", { name: "Log in" })).toHaveCount(0, {
    timeout: 20_000,
  });
}
