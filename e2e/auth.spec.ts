import { expect, test } from "@playwright/test";
import { signInViaUI, signUpViaUI } from "./helpers";

test.describe("Authentication flows", () => {
  test("signup creates an account and shows account indicator", async ({ page }) => {
    const username = `testuser_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(page, username, "testpass123");
  });

  test("login with existing account", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // First, sign up
    const username = `logintest_${Math.random().toString(36).slice(2, 7)}`;
    await signUpViaUI(page, username, "testpass123");

    // Logout — the auth context does a full page reload via
    // window.location.assign("/") after signing out. Wait for that
    // navigation to reach the public landing page before logging back in.
    await page.click('[aria-label="Open navigation"]');
    await page.click('button:has-text("Logout")');
    await page.waitForLoadState("load");
    await expect(page.getByRole("heading", { name: "Tiao", exact: true })).toBeVisible();

    // Login again
    await signInViaUI(page, username, "testpass123");

    await context.close();
  });

  test("guest player can play without account", async ({ page }) => {
    await page.goto("/play");
    // Should load without requiring login
    // Guest should be able to access game features
    await expect(page.locator('button:has-text("Create a game")')).toBeVisible();
    await expect(page.locator('button:has-text("Unlimited time game")')).toBeVisible();
  });
});
