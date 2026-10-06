import { expect, test } from "@playwright/test";
import { signUpViaAPI, waitForAppReady } from "./helpers";

function uniqueName(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("Copy profile link (#93)", () => {
  test("copy profile link button copies URL and shows feedback", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const username = uniqueName("cplink");
    await signUpViaAPI(page, username, "password123");

    // Navigate to the settings page (the own-profile editor)
    await page.goto("/settings");
    await waitForAppReady(page);

    // Grant clipboard permissions so the copy action succeeds
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Click the "Copy profile link" button (expected next to Save / Back to lobby)
    const copyBtn = page.locator('button:has-text("Copy profile link")');
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await copyBtn.click();

    // Button text should temporarily change to "Copied" or a toast should appear
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible({ timeout: 3000 });

    // Verify the clipboard contains the profile URL
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain(`/profile/${username}`);

    await context.close();
  });
});

test.describe("Add friend on public profile (#92)", () => {
  test("can send friend request from public profile page", async ({ browser }) => {
    // Create two separate browser contexts (two different users)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");

    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    // Alice visits Bob's public profile
    await alicePage.goto(`/profile/${bobName}`);
    await waitForAppReady(alicePage);

    // "Add friend" button should be visible on the public profile
    const addFriendBtn = alicePage.locator('button:has-text("Add friend")');
    await expect(addFriendBtn).toBeVisible({ timeout: 5000 });

    // Click "Add friend"
    await addFriendBtn.click();

    // Button should change to indicate the request was sent
    await expect(
      alicePage
        .locator('button:has-text("Request sent")')
        .or(alicePage.locator('button:has-text("Pending")')),
    ).toBeVisible({ timeout: 5000 });

    // Switch to Bob's context — visit Alice's profile
    await bobPage.goto(`/profile/${aliceName}`);
    await waitForAppReady(bobPage);

    // Bob should see an "Accept" button (incoming friend request)
    await expect(
      bobPage
        .locator('button:has-text("Accept")')
        .or(bobPage.locator('button:has-text("Accept request")')),
    ).toBeVisible({ timeout: 5000 });

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe("Delete account (#91)", () => {
  test("user can delete their account via profile page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const username = uniqueName("delme");
    await signUpViaAPI(page, username, "password123");

    // Navigate to the settings page (the own-profile editor)
    await page.goto("/settings");
    await waitForAppReady(page);

    // Scroll to the bottom where the delete button lives
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Click "Delete Account" (or "Permanently Delete Account")
    const deleteBtn = page.locator(
      'button:has-text("Delete Account"), button:has-text("Permanently Delete Account")',
    );
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();

    // Confirmation dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Type the display name to confirm deletion
    const confirmInput = dialog.locator("#delete-confirm-name");
    await expect(confirmInput).toBeVisible({ timeout: 2000 });
    await confirmInput.fill(username);

    // Click the final "Delete My Account" confirmation button
    const confirmDeleteBtn = dialog.locator(
      'button:has-text("Delete My Account"), button:has-text("Delete Account")',
    );
    await confirmDeleteBtn.click();

    // Logout does a full page load to the public home; the page's own
    // router.push("/play") can win that race, so accept either.
    await expect(page).toHaveURL(/\/(play)?$/, { timeout: 10000 });

    await context.close();
  });
});
