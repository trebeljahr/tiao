import { test, expect, Page } from "@playwright/test";
import { signUpViaAPI, waitForAppReady } from "./helpers";

function uniqueName(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Create a tournament via the API directly (faster than UI for setup).
 * Returns the tournament ID.
 */
async function createTournamentViaApi(
  page: Page,
  name: string,
  format: "single-elimination" | "round-robin" | "groups-knockout" = "single-elimination",
  minPlayers = 2,
  maxPlayers = 8,
  timeControl: { initialMs: number; incrementMs: number } | null = null,
): Promise<string> {
  const response = await page.request.post("/api/tournaments", {
    data: {
      name,
      settings: {
        format,
        timeControl,
        scheduling: "simultaneous",
        noShow: { type: "auto-forfeit", timeoutMs: 60000 },
        visibility: "public",
        minPlayers,
        maxPlayers,
      },
    },
  });
  const data = await response.json();
  return data.tournament.tournamentId;
}

/**
 * Helper to start a 2-player tournament and return the match room ID.
 */
async function startTwoPlayerTournament(
  alicePage: Page,
  bobPage: Page,
  name: string,
  timeControl: { initialMs: number; incrementMs: number } | null = null,
): Promise<{ tournamentId: string; roomId: string }> {
  const tournamentId = await createTournamentViaApi(
    alicePage,
    name,
    "single-elimination",
    2,
    4,
    timeControl,
  );

  await alicePage.request.post(`/api/tournaments/${tournamentId}/register`);
  await bobPage.request.post(`/api/tournaments/${tournamentId}/register`);

  const startRes = await alicePage.request.post(`/api/tournaments/${tournamentId}/start`);
  const startData = await startRes.json();
  const roomId = startData.tournament.rounds[0]?.matches[0]?.roomId;

  return { tournamentId, roomId };
}

test.describe("Tournament list page", () => {
  test("tournament list page loads and shows empty state for guests", async ({ page }) => {
    await page.goto("/tournaments");
    await expect(page.locator('h1:has-text("Tournaments")')).toBeVisible();
    await expect(page.locator("text=No public tournaments available right now.")).toBeVisible();
  });

  test("signed-in user sees Create Tournament button and tabs", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    await page.goto("/tournaments");
    await expect(page.locator('button:has-text("Create Tournament")')).toBeVisible();
    await expect(page.locator('button:has-text("Browse")')).toBeVisible();
    await expect(page.locator('button:has-text("My Tournaments")')).toBeVisible();

    await context.close();
  });

  test("created tournament appears in the list", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    const tournamentId = await createTournamentViaApi(page, "Test Cup");

    await page.goto("/tournaments");
    await waitForAppReady(page);
    await expect(page.locator("text=Test Cup")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=REGISTRATION")).toBeVisible();

    await context.close();
  });
});

test.describe("Tournament page", () => {
  test("tournament detail page renders correctly", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    const tournamentId = await createTournamentViaApi(page, "Detail Cup");

    await page.goto(`/tournament/${tournamentId}`);
    await expect(page.locator('h1:has-text("Detail Cup")')).toBeVisible();
    await expect(page.locator("text=REGISTRATION")).toBeVisible();
    await expect(page.locator("text=SINGLE ELIMINATION")).toBeVisible();
    await expect(page.locator("text=0/8 players")).toBeVisible();
    await expect(
      page.locator('h2:has-text("Participants"), h3:has-text("Participants")'),
    ).toBeVisible();

    await context.close();
  });

  test("player can join a tournament", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    const tournamentId = await createTournamentViaApi(page, "Join Cup");

    await page.goto(`/tournament/${tournamentId}`);
    await expect(page.locator('button:has-text("Join Tournament")')).toBeVisible();

    const joinResponse = page.waitForResponse(
      (resp) => resp.url().includes("/register") && resp.ok(),
    );
    await page.click('button:has-text("Join Tournament")');
    await joinResponse;

    // Player should appear in participants
    await expect(page.locator(`text=${username}`)).toBeVisible({ timeout: 5000 });
    // Player count should update
    await expect(page.locator("text=1/8 players")).toBeVisible();

    await context.close();
  });

  test("player can leave a tournament", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    const tournamentId = await createTournamentViaApi(page, "Leave Cup");

    // Register via UI
    await page.goto(`/tournament/${tournamentId}`);
    await page.click('button:has-text("Join Tournament")');
    await expect(page.locator('button:has-text("Leave")')).toBeVisible({ timeout: 10000 });

    const leaveResponse = page.waitForResponse(
      (resp) => resp.url().includes("/unregister") && resp.ok(),
    );
    await page.click('button:has-text("Leave")');
    await leaveResponse;

    await expect(page.locator("text=/0\/8 players/")).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test("admin can cancel a tournament", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    const tournamentId = await createTournamentViaApi(page, "Cancel Cup");

    await page.goto(`/tournament/${tournamentId}`);
    await expect(page.locator('button:has-text("Cancel Tournament")')).toBeVisible();

    await page.click('button:has-text("Cancel Tournament")');
    // Confirmation dialog appears — click "Cancel Tournament" inside it
    const dialog = page.locator(".fixed.inset-0");
    await expect(dialog.locator('button:has-text("Cancel Tournament")')).toBeVisible({
      timeout: 3000,
    });
    const cancelResponse = page.waitForResponse(
      (resp) => resp.url().includes("/cancel") && resp.ok(),
    );
    await dialog.locator('button:has-text("Cancel Tournament")').click();
    await cancelResponse;

    await expect(page.locator("text=cancelled")).toBeVisible({ timeout: 5000 });

    await context.close();
  });
});

test.describe("Tournament with multiple players", () => {
  test("tournament can be started and shows bracket", async ({ browser }) => {
    // Create two browser contexts (two different players)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");

    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    // Use the helper to create, register both, and start via API
    const { tournamentId } = await startTwoPlayerTournament(alicePage, bobPage, "Bracket Cup");

    // Alice navigates to tournament to verify bracket
    await alicePage.goto(`/tournament/${tournamentId}`);

    // Bracket should appear (tournament was started via API)
    await expect(alicePage.locator('h3:has-text("Bracket")')).toBeVisible({ timeout: 10000 });

    // Should see "Current Matches" with an active match
    await expect(alicePage.locator("text=Current Matches")).toBeVisible();
    await expect(alicePage.locator("text=Live").first()).toBeVisible();

    await aliceContext.close();
    await bobContext.close();
  });

  test("no console errors on tournament pages", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    // Visit tournament list
    await page.goto("/tournaments");
    await expect(page.locator('h1:has-text("Tournaments")')).toBeVisible();
    await page.waitForTimeout(500);

    // Create and visit a tournament
    const tournamentId = await createTournamentViaApi(page, "Error Check Cup");
    await page.goto(`/tournament/${tournamentId}`);
    await expect(page.locator('h1:has-text("Error Check Cup")')).toBeVisible();
    await page.waitForTimeout(500);

    // Filter out unrelated browser/auth errors
    const relevantErrors = errors.filter(
      (e) => !e.includes("401") && !e.includes("runtime.lastError") && !e.includes("DevTools"),
    );
    expect(relevantErrors).toEqual([]);

    await context.close();
  });
});

test.describe("Tournament game lifecycle", () => {
  test('timed tournament game shows "waiting for opponent" overlay when only one player connects', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");
    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    const { roomId } = await startTwoPlayerTournament(alicePage, bobPage, "Timer Overlay Test", {
      initialMs: 300000,
      incrementMs: 0,
    });

    // Alice navigates to game — she's the only one connected
    await alicePage.goto(`/game/${roomId}`);
    await expect(alicePage.locator("text=Waiting for opponent to connect")).toBeVisible({
      timeout: 5000,
    });

    // Verify the tournament context bar is visible
    await expect(alicePage.locator("text=Back to bracket")).toBeVisible();

    await aliceContext.close();
    await bobContext.close();
  });

  test("waiting overlay disappears when second player connects to timed game", async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");
    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    const { roomId } = await startTwoPlayerTournament(alicePage, bobPage, "Both Connect Test", {
      initialMs: 300000,
      incrementMs: 0,
    });

    // Alice connects first
    await alicePage.goto(`/game/${roomId}`);
    await expect(alicePage.locator("text=Waiting for opponent to connect")).toBeVisible({
      timeout: 5000,
    });

    // Bob connects
    await bobPage.goto(`/game/${roomId}`);

    // Overlay should disappear for Alice (game is now "ready")
    await expect(alicePage.locator("text=Waiting for opponent to connect")).not.toBeVisible({
      timeout: 10000,
    });

    // Both should see "Live match"
    await expect(alicePage.locator("text=Live match")).toBeVisible({ timeout: 5000 });
    await expect(bobPage.locator("text=Live match")).toBeVisible({ timeout: 5000 });

    await aliceContext.close();
    await bobContext.close();
  });

  test("untimed tournament game has no waiting overlay", async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    const aliceName = uniqueName("alice");
    const bobName = uniqueName("bob");
    await signUpViaAPI(alicePage, aliceName, "password123");
    await signUpViaAPI(bobPage, bobName, "password123");

    const { roomId } = await startTwoPlayerTournament(
      alicePage,
      bobPage,
      "Untimed No Overlay Test",
      null, // untimed
    );

    // Alice connects — should NOT see waiting overlay
    await alicePage.goto(`/game/${roomId}`);
    await expect(alicePage.locator("text=Live match")).toBeVisible({ timeout: 5000 });
    await expect(alicePage.locator("text=Waiting for opponent to connect")).not.toBeVisible();

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe("Tournament navigation", () => {
  test("tournament link appears in nav for signed-in users", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    await page.goto("/");

    // Open the nav drawer
    await page.click('[aria-label="Open navigation"]');

    // Tournaments link should be visible
    await expect(page.locator('button:has-text("Tournaments")')).toBeVisible();

    // Click it and verify navigation
    await page.click('button:has-text("Tournaments")');
    await expect(page).toHaveURL(/\/tournaments/);

    await context.close();
  });

  test("clicking View on a tournament card navigates to detail page", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const username = uniqueName("tourney");
    await signUpViaAPI(page, username, "password123");

    const tournamentId = await createTournamentViaApi(page, "Nav Cup");

    await page.goto("/tournaments");
    await expect(page.locator("text=Nav Cup")).toBeVisible({ timeout: 5000 });

    // Click the tournament card (it's a clickable card)
    await page.locator("text=Nav Cup").click();
    await expect(page).toHaveURL(new RegExp(`/tournament/${tournamentId}`));

    await context.close();
  });
});
