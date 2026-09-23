import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { signUpViaAPI } from "./helpers";

const CLIENT_ORIGIN = `http://localhost:${process.env.E2E_CLIENT_PORT || "3001"}`;

/**
 * Embeddable finished-game replay (/embed/game/:id).
 *
 * Covers the three pieces that have to line up for a third-party iframe
 * to work: the frame-ancestors header exception scoped to /embed/, the
 * public replay endpoint (no session cookie inside a cross-site frame),
 * and the review-mode step controls in the stripped-down page.
 */
test("finished game can be iframed cross-origin and stepped through", async ({ browser }) => {
  test.setTimeout(90_000);
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  const aliceName = `alice_${Math.random().toString(36).slice(2, 7)}`;
  const bobName = `bob_${Math.random().toString(36).slice(2, 7)}`;
  await signUpViaAPI(alicePage, aliceName, "password123");
  await signUpViaAPI(bobPage, bobName, "password123");

  // Alice creates, Bob joins.
  await alicePage.click('button:has-text("Create a game")');
  await alicePage.click('button:has-text("Create Game")');
  await expect(alicePage).toHaveURL(/\/game\/[A-Z0-9]{6}/);
  const gameUrl = alicePage.url();
  const gameId = gameUrl.split("/").pop()!;
  await bobPage.goto(gameUrl);
  await expect(bobPage.locator("text=Live match")).toBeVisible({ timeout: 10_000 });

  // While the game is live the embed endpoint must refuse to serve it.
  const liveReplay = await alicePage.request.get(`/api/games/${gameId}/replay`);
  expect(liveReplay.status()).toBe(404);
  expect(await liveReplay.json()).toMatchObject({ code: "GAME_NOT_FINISHED" });

  // Regular routes stay frame-blocked; the embed route opts in.
  const gamePageResponse = await alicePage.request.get(`/game/${gameId}`);
  expect(gamePageResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(gamePageResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const embedResponse = await alicePage.request.get(`/embed/game/${gameId}`);
  expect(embedResponse.headers()["x-frame-options"]).toBeUndefined();
  expect(embedResponse.headers()["content-security-policy"]).toContain("frame-ancestors *");

  // Play one stone each over the game socket so the replay has moves to
  // step through, then finish the game so it becomes replayable.
  const firstSnapshot = await placeViaSocket(alicePage, gameId, null);
  const whitePage = firstSnapshot.whiteName === aliceName ? alicePage : bobPage;
  const blackPage = whitePage === alicePage ? bobPage : alicePage;
  await placeViaSocket(whitePage, gameId, { x: 4, y: 4 });
  await placeViaSocket(blackPage, gameId, { x: 14, y: 14 });

  await alicePage.evaluate(async (id) => {
    await fetch(`/api/games/${id}/test-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: "white" }),
    });
  }, gameId);
  await expect(alicePage.getByRole("heading", { name: /wins/ })).toBeVisible({ timeout: 5000 });

  // Seats are assigned randomly, so read the winner's name off the public
  // payload instead of assuming Alice is white.
  const replayResponse = await alicePage.request.get(`/api/games/${gameId}/replay`);
  expect(replayResponse.status()).toBe(200);
  const { replay } = (await replayResponse.json()) as {
    replay: {
      winner: "white" | "black";
      white: { displayName: string };
      black: { displayName: string };
    };
  };
  const winnerName = replay[replay.winner].displayName;

  // Reload into plain review mode (the live game-over dialog would sit on
  // top of the header pills) — the share page now offers the embed snippet.
  await alicePage.goto(gameUrl, { waitUntil: "domcontentloaded" });
  await expect(alicePage.getByTestId("review-nav-buttons")).toBeVisible({ timeout: 15_000 });
  await aliceContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  await alicePage.getByRole("button", { name: "Copy embed code" }).click();
  const clipboard = await alicePage.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain(`<iframe src="${CLIENT_ORIGIN}/embed/game/${gameId}"`);
  expect(clipboard).toMatch(/<\/iframe>$/);

  // Host the snippet on a different origin (127.0.0.1:<random> vs the
  // app's localhost:<port>): no shared cookies or storage with the app,
  // so this exercises the public replay endpoint the way a blog embed
  // would. It has to be a real loopback server rather than a
  // route-fulfilled fake site — Chrome's Local Network Access check
  // refuses to let a public-looking origin frame a localhost URL, and
  // route-fulfilled responses count as public.
  const hostServer = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<!doctype html><html><body><h1>Host page</h1>${clipboard}</body></html>`);
  });
  await new Promise<void>((resolve) => hostServer.listen(0, "127.0.0.1", resolve));
  const hostPort = (hostServer.address() as AddressInfo).port;
  const hostContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  try {
    await hostPage.goto(`http://127.0.0.1:${hostPort}/`);
    await verifyEmbedWidget(hostPage, { aliceName, bobName, winnerName, gameId });
  } finally {
    await hostContext.close();
    hostServer.close();
  }
  await aliceContext.close();
  await bobContext.close();
});

/**
 * Opens the game WebSocket from the page's own origin (so the session
 * cookie rides along), waits for the current snapshot and, when a
 * position is given, places a stone there and waits for the resulting
 * snapshot. Returns the seat names from the last snapshot seen.
 */
function placeViaSocket(page: Page, gameId: string, position: { x: number; y: number } | null) {
  return page.evaluate(
    ({ gameId, position }) =>
      new Promise<{ whiteName: string | null; historyLength: number }>((resolve, reject) => {
        const url = new URL("/api/ws", window.location.origin);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("gameId", gameId);
        const socket = new WebSocket(url.toString());
        let sent = false;
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error("socket timeout"));
        }, 15_000);
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data as string);
          if (message.type === "error") {
            clearTimeout(timer);
            socket.close();
            reject(new Error(message.message));
            return;
          }
          if (message.type !== "snapshot") return;
          const snapshot = message.snapshot;
          if (position && !sent) {
            sent = true;
            socket.send(JSON.stringify({ type: "place-piece", position }));
            return;
          }
          clearTimeout(timer);
          socket.close();
          resolve({
            whiteName: snapshot.seats.white?.player.displayName ?? null,
            historyLength: snapshot.state.history.length,
          });
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("socket error"));
        };
      }),
    { gameId, position },
  );
}

async function verifyEmbedWidget(
  hostPage: Page,
  {
    aliceName,
    bobName,
    winnerName,
    gameId,
  }: Record<"aliceName" | "bobName" | "winnerName" | "gameId", string>,
) {
  const frame = hostPage.frameLocator("iframe");

  await expect(frame.getByTestId("embed-board")).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByTestId("embed-players")).toContainText(aliceName);
  await expect(frame.getByTestId("embed-players")).toContainText(bobName);
  await expect(frame.getByTestId("embed-result")).toContainText(`${winnerName} wins`);
  // No app chrome inside the widget.
  await expect(frame.getByRole("navigation")).toHaveCount(0);

  // Two stones were placed before the finish; the widget opens on the
  // last board move and the step controls walk the history.
  const counter = frame.getByTestId("embed-move-counter");
  await expect(counter).toHaveText("Move 2 of 2");
  await frame.getByRole("button", { name: "Go to start" }).click();
  await expect(counter).toHaveText("Move 0 of 2");
  await frame.getByRole("button", { name: "Next move" }).click();
  await expect(counter).toHaveText("Move 1 of 2");
  await frame.getByRole("button", { name: "Previous move" }).click();
  await expect(counter).toHaveText("Move 0 of 2");
  await frame.getByRole("button", { name: "Go to end" }).click();
  await expect(counter).toHaveText("Move 2 of 2");

  // The "open" link points back at the canonical share page.
  await expect(frame.getByTestId("embed-open-link")).toHaveAttribute("href", `/game/${gameId}`);
}
