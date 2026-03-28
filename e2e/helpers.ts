import { Page } from "@playwright/test";

/**
 * Opens the nav drawer (hamburger menu) and clicks "Sign up",
 * fills in the form, and submits. Waits for the signup API to succeed.
 */
export async function signUpViaUI(page: Page, username: string, password: string, email?: string) {
  const testEmail = email || `${username}@test.tiao.local`;

  await page.goto("/");
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
