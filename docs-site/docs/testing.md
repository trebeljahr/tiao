---
sidebar_position: 5
title: Testing
---

# Testing Guide

Tiao uses three test frameworks across three layers:

| Layer             | Framework                                                                                                              | Config                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Server unit tests | Node.js built-in [`node:test`](https://nodejs.org/docs/latest-v22.x/api/test.html)                                     | [`server/package.json`][fn-package.json] ("test" script) |
| Client unit tests | [Vitest](https://vitest.dev/) + [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/) | [`client/vite.config.mts`][fn-vite.config.mts]           |
| E2E tests         | [Playwright](https://playwright.dev/)                                                                                  | [`playwright.config.ts`][fn-playwright.config.ts]        |

## Running Tests

```bash
# Server unit tests (compiles TypeScript first, then runs)
npm --prefix server test

# Client unit tests
cd client && npx vitest run              # single run
cd client && npx vitest                  # watch mode
cd client && npx vitest --ui             # interactive browser UI

# E2E tests (Docker required — spins up an isolated MongoDB container)
npm run test:e2e                          # all specs
npx playwright test e2e/auth.spec.ts     # single file
npx playwright test --headed              # visible browser
npx playwright show-report                # HTML report
```

E2E tests are fully isolated from your dev environment. The E2E startup script spins up dedicated containers for MongoDB (port 27018), Redis (port 6380), and MinIO (port 9002). The server connects to these instead of your dev infrastructure, and `globalTeardown` stops all containers when tests finish. No test data touches your dev databases.

If the servers are already running, Playwright reuses them (locally only). In CI, fresh servers are started automatically.

## Test File Locations

### Server Tests (`server/tests/`)

| File                                                              | What it covers                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`tiaoCore.test.ts`][fn-tiaoCore.test.ts]                         | Core game rules: initial state, border rule, cluster rule, jump chains, undo, jump origins, game over                                                                           |
| [`tiaoCoreEdgeCases.test.ts`][fn-tiaoCoreEdgeCases.test.ts]       | Edge cases: occupied/OOB placement, own-piece jumps, diagonal jumps, multi-jump chains, border corners, cluster shapes, game-over at 10, pending jump blocks, utility functions |
| [`api.test.ts`][fn-api.test.ts]                                   | REST endpoints: health check, guest auth, logout, game CRUD, matchmaking API, auth enforcement                                                                                  |
| [`authRoutes.test.ts`][fn-authRoutes.test.ts]                     | Auth routes: signup/login 503 behavior, guest creation, display name truncation, session management                                                                             |
| [`gameService.test.ts`][fn-gameService.test.ts]                   | Service layer: room persistence, seat randomization, guest limits, game library, spectators, online status, matchmaking, rematch flow                                           |
| [`gameServiceActions.test.ts`][fn-gameServiceActions.test.ts]     | Game actions via service: place-piece, turn enforcement, spectator rejection, jump+confirm capture, undo, broadcasts, rematch guards                                            |
| [`matchmakingEdgeCases.test.ts`][fn-matchmakingEdgeCases.test.ts] | Matchmaking: double-join, leave queue, matched state cleanup, guest limits, three-player queue                                                                                  |
| [`boardHarness.ts`][fn-boardHarness.ts]                           | Test utility (not a test file)                                                                                                                                                  |

### Client Tests (`client/src/`)

| File                                                          | What it covers                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`App.test.tsx`][fn-App.test.tsx]                             | App component renders with router                                                                      |
| [`computer-ai.test.ts`][fn-computer-ai.test.ts]               | AI strategy: placement selection, center bias, jump preference, game-over handling                     |
| [`useLocalGame.test.tsx`][fn-useLocalGame.test.tsx]           | Local game: turn alternation, piece selection, jump targets, color validation                          |
| [`useGamesIndex.test.ts`][fn-useGamesIndex.test.ts]           | Games list: initialization, conditional fetch, malformed responses, auth state changes                 |
| [`useComputerGame.test.tsx`][fn-useComputerGame.test.tsx]     | Computer game: human turn start, click blocking during AI turn, controls disabled state                |
| [`useMultiplayerGame.test.ts`][fn-useMultiplayerGame.test.ts] | Multiplayer: connect/disconnect, snapshot updates, optimistic updates, error handling, message sending |
| [`useMatchmakingData.test.ts`][fn-useMatchmakingData.test.ts] | Matchmaking hook: enter/cancel, polling, immediate match, null auth guard                              |
| [`useSocialData.test.ts`][fn-useSocialData.test.ts]           | Social: friend request CRUD, search, guest guards, auth state transitions                              |

### E2E Tests (`e2e/`)

| File                                                  | What it covers                                          |
| ----------------------------------------------------- | ------------------------------------------------------- |
| [`localTurns.spec.ts`][fn-localTurns.spec.ts]         | Local game turn alternation and opponent piece blocking |
| [`localGameFull.spec.ts`][fn-localGameFull.spec.ts]   | Score display, piece persistence, jump capture workflow |
| [`computerGame.spec.ts`][fn-computerGame.spec.ts]     | Human vs AI: placement, AI response, turn enforcement   |
| [`rematch.spec.ts`][fn-rematch.spec.ts]               | Full multiplayer rematch accept flow                    |
| [`rematchDecline.spec.ts`][fn-rematchDecline.spec.ts] | Rematch request and decline flow                        |
| [`matchmaking.spec.ts`][fn-matchmaking.spec.ts]       | Two players queue and get matched                       |
| [`auth.spec.ts`][fn-auth.spec.ts]                     | Signup, login, guest access                             |
| [`spectator.spec.ts`][fn-spectator.spec.ts]           | Third player views game without joining                 |
| [`lobby.spec.ts`][fn-lobby.spec.ts]                   | Lobby buttons, game creation, active game list          |

## Server Test Harness

### Route-Level Testing (api.test.ts, authRoutes.test.ts)

Server tests don't spin up an HTTP server. Instead, they import Express routers directly and invoke route handlers with mock `req`/`res` objects:

```typescript
const response = await invokeRoute<AuthResponse>(gameAuthRoutes, {
  method: "post",
  path: "/guest",
  body: { displayName: "Alice" },
});

assert.equal(response.status, 201);
assert.equal(response.body.player.displayName, "Alice");
```

The `invokeRoute` helper finds the matching route layer on the Express router, constructs a mock request with the given method/path/body/cookie, runs all middleware handlers in sequence, and returns `{ status, body, headers }`.

### Singleton Patching

The `gameService` singleton is monkey-patched in `beforeEach` with a fresh instance backed by `InMemoryGameRoomStore`:

```typescript
beforeEach(async () => {
  const service = new GameService(new InMemoryGameRoomStore(), () => 0);
  singletonGameService.createGame = service.createGame.bind(service);
  // ... same for all methods
});

afterEach(() => {
  Object.assign(singletonGameService, originalMethods);
});
```

The `resetPlayerSessionStoreForTests()` function clears the in-memory session store between tests.

### Board ASCII Harness (boardHarness.ts)

Create game states from ASCII diagrams for readable tests:

```typescript
const state = stateFromDiagram(
  `
  W . .
  . B .
  . . .
`,
  { origin: { x: 5, y: 5 }, turn: "white" },
);

// W = white, B = black, . = empty
// origin offsets the diagram onto the 19x19 board
```

Assert board regions the same way:

```typescript
assertRegion(
  state,
  `
  . . .
  . B .
  . . W
`,
  { origin: { x: 5, y: 5 } },
);
```

### FakeSocket

A minimal WebSocket mock that captures sent messages:

```typescript
class FakeSocket {
  readyState = WebSocket.OPEN;
  messages: string[] = [];
  send(message: string) {
    this.messages.push(message);
  }
}
```

## Client Test Harness

### API Mocking with vi.mock

Every hook test mocks the API module to prevent real HTTP calls:

```typescript
const mockEnterMatchmaking = vi.fn();

vi.mock("../api", () => ({
  enterMatchmaking: (...args) => mockEnterMatchmaking(...args),
}));
```

Error toasts are also mocked to keep tests silent:

```typescript
vi.mock("../errors", () => ({ toastError: vi.fn() }));
```

### Hook Testing with renderHook

React hooks are tested using `renderHook` from `@testing-library/react`:

```typescript
const { result } = renderHook(() => useMatchmakingData(mockAuth, onMatched));

await act(async () => {
  await result.current.handleEnterMatchmaking();
});

expect(result.current.matchmaking.status).toBe("searching");
```

### MockWebSocket

For WebSocket-dependent hooks (`useMultiplayerGame`, `useLobbySocket`), a mock WebSocket class is injected:

```typescript
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  // ... captures addEventListener calls, exposes simulateOpen/simulateMessage/simulateClose
}

vi.stubGlobal("WebSocket", MockWebSocket);
```

### Fake Timers

For timer-dependent hooks (`useComputerGame`, `useMatchmakingData`):

```typescript
vi.useFakeTimers();

// Advance time to trigger polling interval
await act(async () => {
  vi.advanceTimersByTime(2100);
});

vi.useRealTimers();
```

## E2E Test Patterns

### Multi-Player Tests

Each player gets a separate browser context with its own cookies:

```typescript
const aliceContext = await browser.newContext();
const bobContext = await browser.newContext();
const alicePage = await aliceContext.newPage();
const bobPage = await bobContext.newPage();
```

### Board Cell Selection

Board cells have `data-testid="cell-{x}-{y}"` attributes:

```typescript
function cell(page, x, y) {
  return page.locator(`[data-testid="cell-${x}-${y}"]`);
}

await cell(page, 9, 9).click();
await expect(cell(page, 9, 9)).toHaveAttribute("data-piece", "white");
```

### Force-Finishing Games

The `test-finish` dev endpoint skips a full game playthrough:

```typescript
await page.evaluate(async (gameId) => {
  await fetch(`/api/games/${gameId}/test-finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ winner: "white" }),
  });
}, gameId);
```

## Adding New Tests

### Server test

1. Create `server/tests/yourTest.test.ts`
2. Use `node:test` and `node:assert/strict`
3. Import from `../../shared/src` for game types/functions
4. Use `InMemoryGameRoomStore` and `resetPlayerSessionStoreForTests()` for isolation
5. Run with `npm --prefix server test`

### Client test

1. Create `client/src/lib/hooks/yourHook.test.ts` (or `.tsx` if rendering components)
2. Use Vitest globals (`describe`, `it`, `expect`, `vi`)
3. Mock API calls with `vi.mock("../api", ...)`
4. Use `renderHook` for hook tests, `render` for component tests
5. Run with `cd client && npx vitest run`

### E2E test

1. Create `e2e/yourFlow.spec.ts`
2. Use `@playwright/test` (`test`, `expect`)
3. Use `browser.newContext()` for multi-player scenarios
4. Use `e2e/db-utils.ts` to query or clean the test database directly:

   ```typescript
   import { getCollection, cleanDatabase } from "./db-utils";

   test.beforeAll(async () => {
     await cleanDatabase();
   });

   test("user is persisted", async ({ page }) => {
     // ... sign up via the UI ...
     const accounts = await getCollection("gameaccounts");
     const user = await accounts.findOne({ displayName: "Alice" });
     expect(user).toBeTruthy();
   });
   ```

5. Run with `npx playwright test e2e/yourFlow.spec.ts --headed`
