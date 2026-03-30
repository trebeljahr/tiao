import { expect, Page } from "@playwright/test";

/**
 * Wait for the app loading screen ("Opening Tiao") to disappear.
 * The AppShell shows a loading screen while auth bootstraps (creating
 * an anonymous guest session on first visit). Call this after page.goto()
 * when the test doesn't sign up/in (which already waits for the API).
 */
export async function waitForAppReady(page: Page) {
  await expect(page.locator("text=Opening Tiao")).not.toBeVisible({ timeout: 20000 });
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

  // Call the test-auth endpoint to create a user and get session token
  const response = await page.request.post("/api/test-auth", {
    data: { username, password, email: testEmail },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`test-auth failed (${response.status()}): ${body}`);
  }

  // Navigate to the lobby so the page is ready for interaction
  await page.goto("/");
  await waitForAppReady(page);
}

/**
 * Opens the nav drawer (hamburger menu) and clicks "Sign up",
 * fills in the form, and submits. Waits for the signup API to succeed.
 * Use signUpViaAPI for faster non-auth tests.
 */
export async function signUpViaUI(page: Page, username: string, password: string, email?: string) {
  const testEmail = email || `${username}@test.tiao.local`;

  await page.goto("/");
  await waitForAppReady(page);
  await page.click('[aria-label="Open navigation"]');
  await page.click('button:has-text("Sign up")');
  await page.fill("#signup-display-name", username);
  await page.fill("#signup-email", testEmail);
  await page.fill("#signup-password", password);
  await page.fill("#signup-confirm-password", password);
  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/auth/sign-up/email") && resp.ok(),
  );
  await page.click('button:has-text("Create account")');
  await responsePromise;
}

/**
 * Opens the nav drawer and clicks "Sign in",
 * fills in credentials and submits. Waits for login API to succeed.
 */
export async function signInViaUI(page: Page, usernameOrEmail: string, password: string) {
  await page.goto("/");
  await waitForAppReady(page);
  await page.click('[aria-label="Open navigation"]');
  await page.click('button:has-text("Sign in")');
  await page.fill("#login-email", usernameOrEmail);
  await page.fill("#login-password", password);
  const responsePromise = page.waitForResponse(
    (resp) => resp.url().includes("/api/player/login") && resp.ok(),
  );
  await page.click('button[type="submit"]:has-text("Sign in")');
  await responsePromise;
}
