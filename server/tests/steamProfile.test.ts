import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchSteamProfile, steamAvatarUrl, steamUsernameSuggestion } from "../auth/steamProfile";

const originalFetch = globalThis.fetch;
const key = process.env.STEAM_WEB_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (key === undefined) delete process.env.STEAM_WEB_API_KEY;
  else process.env.STEAM_WEB_API_KEY = key;
});

test("Steam persona defaults produce editable valid username suggestions", () => {
  assert.equal(steamUsernameSuggestion("Mäia Jump!"), "maia-jump");
  assert.equal(steamUsernameSuggestion("A"), "a-player");
  assert.equal(steamUsernameSuggestion("__Hello   World__"), "hello-world");
  assert.equal(steamUsernameSuggestion("x".repeat(50)).length, 32);
  assert.equal(steamUsernameSuggestion("跳"), "");
});
test("only HTTPS Steam avatar hosts are accepted", () => {
  assert.equal(
    steamAvatarUrl("https://avatars.steamstatic.com/avatar_full.jpg"),
    "https://avatars.steamstatic.com/avatar_full.jpg",
  );
  for (const url of [
    "http://avatars.steamstatic.com/a",
    "https://avatars.steamstatic.com.evil.test/a",
    "https://user:pass@avatars.steamstatic.com/a",
    "https://127.0.0.1/a",
    "data:image/png,fake",
  ])
    assert.equal(steamAvatarUrl(url), undefined);
});
test("profile lookup matches the verified SteamID and does not trust another returned profile", async () => {
  process.env.STEAM_WEB_API_KEY = "fake-key";
  globalThis.fetch = (async () =>
    Response.json({
      response: {
        players: [
          {
            steamid: "76561198000000002",
            personaname: "Wrong Player",
            avatarfull: "https://avatars.steamstatic.com/wrong.jpg",
          },
        ],
      },
    })) as typeof fetch;
  assert.deepEqual(await fetchSteamProfile("76561198000000001"), {
    displayName: "",
    suggestedUsername: "player-000001",
    avatarUrl: undefined,
  });
});
test("private/unavailable profile metadata never blocks signup", async () => {
  process.env.STEAM_WEB_API_KEY = "fake-key";
  globalThis.fetch = (async () => {
    throw new Error("Offline");
  }) as typeof fetch;
  assert.deepEqual(await fetchSteamProfile("76561198000000001"), {
    displayName: "",
    suggestedUsername: "player-000001",
  });
});
