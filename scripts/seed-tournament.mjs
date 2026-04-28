#!/usr/bin/env node
/*
 * seed-tournament — dev-only helper for exercising tournament flow states
 * at scale. Creates N bot accounts, registers them into a brand-new
 * tournament, starts it, and optionally walks the bracket forward by
 * force-resolving matches via the dev-only admin endpoint. The goal is to
 * let you reach interesting mid-tournament states in seconds instead of
 * having to play dozens of real games.
 *
 * Prerequisites:
 *   1. Dev server is running (default http://localhost:3100).
 *   2. An admin account exists locally. Defaults match the tiao dev
 *      workflow: username=`testuser123456`, password=`password`. Override
 *      with --admin-email / --admin-password / --base-url.
 *
 * Usage examples:
 *   node scripts/seed-tournament.mjs --players 8 --format round-robin
 *     → creates 8 bots + a round-robin, starts it, leaves all matches live
 *
 *   node scripts/seed-tournament.mjs --players 8 --format single-elimination --advance 2
 *     → advances the first 2 rounds using lowest-seed-wins tiebreak
 *
 *   node scripts/seed-tournament.mjs --players 16 --format single-elimination --advance all-but-last
 *     → leaves only the final match pending so you can play it yourself
 *
 * Never run this against a production deployment. The dev-force endpoint
 * is guarded by NODE_ENV !== "production" on the server anyway, but keep
 * your hands off regardless.
 */

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args["base-url"] ?? "http://localhost:3100";
const ADMIN_USERNAME = args["admin-email"] ?? "testuser123456";
const ADMIN_PASSWORD = args["admin-password"] ?? "password";
const PLAYERS = Number.parseInt(args.players ?? "4", 10);
const FORMAT = args.format ?? "round-robin";
const ADVANCE = args.advance ?? null; // "K" | "half" | "all-but-last" | null
const NAME_PREFIX = args["name-prefix"] ?? `seed-${Date.now().toString(36)}`;

if (!Number.isFinite(PLAYERS) || PLAYERS < 2) {
  console.error("--players must be an integer >= 2");
  process.exit(1);
}
if (!["round-robin", "single-elimination", "groups-knockout"].includes(FORMAT)) {
  console.error("--format must be round-robin | single-elimination | groups-knockout");
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function http(path, { method = "GET", body, cookies } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      // better-auth's CSRF guard rejects requests with no Origin header.
      // Set one explicitly so the Node script is treated like a
      // legitimate same-origin browser request.
      Origin: BASE_URL,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  const contentType = res.headers.get("content-type") ?? "";
  let payload = null;
  if (contentType.includes("application/json")) {
    payload = await res.json();
  } else {
    payload = await res.text();
  }
  return { status: res.status, ok: res.ok, payload, setCookie };
}

function parseSessionCookie(setCookieHeader) {
  // We only care about passing the opaque session cookie back to the
  // server; we don't decode it. Pick the first `better-auth.session_token`
  // (or similar) entry and return just the `name=value` portion.
  if (!setCookieHeader) return "";
  return setCookieHeader
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.trim().split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function signUpBot(index) {
  const name = `${NAME_PREFIX}-bot-${String(index).padStart(3, "0")}`;
  // `.invalid` TLD is reserved by RFC 2606 for addresses that must never
  // reach real mail infrastructure. Paired with the @tiao-seed.invalid
  // skip check in server/auth/email.ts, this guarantees seed signups
  // never burn through the email provider's quota.
  const email = `${name}@tiao-seed.invalid`;
  const password = "SeedBot1!";

  // Bot signup — if the account already exists, the endpoint returns 400;
  // fall through to sign-in in that case.
  let res = await http("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password, name },
  });
  if (!res.ok) {
    res = await http("/api/auth/sign-in/email", {
      method: "POST",
      body: { email, password },
    });
    if (!res.ok) {
      throw new Error(
        `Bot ${name} signup + sign-in both failed: ${res.status} ${JSON.stringify(res.payload)}`,
      );
    }
  }
  const cookie = parseSessionCookie(res.setCookie);
  if (!cookie) {
    throw new Error(`Bot ${name} signed up but no session cookie returned`);
  }
  return { name, email, password, cookie };
}

async function signInAdmin() {
  // Use tiao's custom /api/player/login wrapper — it accepts either a
  // username or an email and forwards to better-auth's email sign-in
  // after resolving the email from the username. Better-auth's raw
  // /sign-in/email endpoint rejects anything that isn't an email.
  const res = await http("/api/player/login", {
    method: "POST",
    body: { identifier: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!res.ok) {
    throw new Error(
      `Admin sign-in failed (${res.status}): ${JSON.stringify(res.payload)}. ` +
        "Override with --admin-email / --admin-password if needed.",
    );
  }
  return parseSessionCookie(res.setCookie);
}

async function createTournament(adminCookie) {
  const settings = {
    format: FORMAT,
    timeControl: null,
    scheduling: "simultaneous",
    noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
    visibility: "public",
    minPlayers: Math.max(2, Math.min(PLAYERS, 2)),
    maxPlayers: Math.max(PLAYERS, 2),
    ...(FORMAT === "groups-knockout" ? { groupSize: 4 } : {}),
  };
  const res = await http("/api/tournaments", {
    method: "POST",
    cookies: adminCookie,
    body: {
      name: `Seeded ${FORMAT} (${PLAYERS}p) ${new Date().toLocaleTimeString()}`,
      description: "Auto-generated by seed-tournament.mjs",
      settings,
    },
  });
  if (!res.ok) {
    throw new Error(`Create tournament failed: ${res.status} ${JSON.stringify(res.payload)}`);
  }
  return res.payload.tournament;
}

async function registerBot(tournamentId, botCookie) {
  const res = await http(`/api/tournaments/${tournamentId}/register`, {
    method: "POST",
    cookies: botCookie,
  });
  if (!res.ok) {
    throw new Error(`Bot register failed: ${res.status} ${JSON.stringify(res.payload)}`);
  }
}

async function startTournament(tournamentId, adminCookie) {
  const res = await http(`/api/tournaments/${tournamentId}/start`, {
    method: "POST",
    cookies: adminCookie,
  });
  if (!res.ok) {
    throw new Error(`Start tournament failed: ${res.status} ${JSON.stringify(res.payload)}`);
  }
  return res.payload.tournament;
}

async function getTournament(tournamentId) {
  const res = await http(`/api/tournaments/${tournamentId}`);
  if (!res.ok) {
    throw new Error(`Get tournament failed: ${res.status}`);
  }
  return res.payload.tournament;
}

async function forceMatch(tournamentId, matchId, winnerId, adminCookie, match) {
  // Prefer the dev-force endpoint (records a fabricated score), but fall
  // back to the regular creator-level forfeit endpoint if the signed-in
  // admin isn't a *site* admin. That still advances the bracket cleanly
  // because both paths funnel through checkRoundAdvancement +
  // createRoomsForActiveRound.
  let res = await http(`/api/player/admin/tournaments/${tournamentId}/dev-force-match-result`, {
    method: "POST",
    cookies: adminCookie,
    body: {
      matchId,
      winnerId,
      scoreWhite: 10,
      scoreBlack: 3,
      finishReason: "captured",
    },
  });
  if (res.ok) return;

  if (res.status === 403) {
    const loserId = match.players.find((p) => p && p.playerId !== winnerId)?.playerId;
    if (!loserId) {
      throw new Error(`Cannot forfeit match ${matchId}: couldn't identify loser from players`);
    }
    res = await http(`/api/tournaments/${tournamentId}/matches/${matchId}/forfeit`, {
      method: "POST",
      cookies: adminCookie,
      body: { loserId },
    });
    if (res.ok) return;
  }

  throw new Error(`Force match ${matchId} failed: ${res.status} ${JSON.stringify(res.payload)}`);
}

function* iterateAllMatches(tournament) {
  for (const round of tournament.rounds) for (const m of round.matches) yield { round, match: m };
  for (const round of tournament.knockoutRounds)
    for (const m of round.matches) yield { round, match: m };
  for (const group of tournament.groups)
    for (const round of group.rounds) for (const m of round.matches) yield { round, match: m };
}

/**
 * Walk every currently-active match and force-resolve it via the dev
 * endpoint. Lower-seed player wins by default (deterministic). Refetches
 * the tournament between iterations because resolving a match can
 * cascade into new matches being activated.
 */
async function advance(tournamentId, adminCookie, targetDescriptor) {
  const maxPasses = 200;
  let passes = 0;
  let roundsResolved = 0;

  while (passes++ < maxPasses) {
    const tournament = await getTournament(tournamentId);

    if (tournament.status === "finished" || tournament.status === "cancelled") break;

    // Identify active matches we can resolve right now.
    const activeMatches = [];
    for (const { match } of iterateAllMatches(tournament)) {
      if (match.status !== "active") continue;
      if (!match.players[0] || !match.players[1]) continue;
      activeMatches.push(match);
    }

    if (activeMatches.length === 0) break;

    // Leave the last final alone when asked.
    if (targetDescriptor === "all-but-last") {
      const finals = lastRoundMatches(tournament);
      if (finals.length === 1 && activeMatches.some((m) => m.matchId === finals[0].matchId)) {
        const nonFinal = activeMatches.filter((m) => m.matchId !== finals[0].matchId);
        if (nonFinal.length === 0) break;
        for (const match of nonFinal) {
          await resolveMatch(tournamentId, match, adminCookie);
        }
        continue;
      }
    }

    for (const match of activeMatches) {
      await resolveMatch(tournamentId, match, adminCookie);
    }
    roundsResolved++;

    if (typeof targetDescriptor === "number" && roundsResolved >= targetDescriptor) break;
    if (targetDescriptor === "half") {
      const finalCountLooksHalfDone = roundsResolved >= Math.ceil(totalRoundCount(tournament) / 2);
      if (finalCountLooksHalfDone) break;
    }
  }
}

function lastRoundMatches(tournament) {
  const koRounds = tournament.knockoutRounds ?? [];
  if (koRounds.length > 0) return koRounds[koRounds.length - 1].matches ?? [];
  const rounds = tournament.rounds ?? [];
  if (rounds.length > 0) return rounds[rounds.length - 1].matches ?? [];
  return [];
}

function totalRoundCount(tournament) {
  return (
    (tournament.rounds?.length ?? 0) +
    (tournament.knockoutRounds?.length ?? 0) +
    (tournament.groups ?? []).reduce((acc, g) => acc + (g.rounds?.length ?? 0), 0)
  );
}

async function resolveMatch(tournamentId, match, adminCookie) {
  // Deterministic: lower seed wins.
  const p0 = match.players[0];
  const p1 = match.players[1];
  const winner = (p0?.seed ?? 999) <= (p1?.seed ?? 999) ? p0 : p1;
  if (!winner) return;
  await forceMatch(tournamentId, match.matchId, winner.playerId, adminCookie, match);
}

async function main() {
  console.log(`🎫 Seeding tournament: ${PLAYERS} players, format=${FORMAT}, base=${BASE_URL}`);

  const adminCookie = await signInAdmin();
  console.log("✓ Signed in as admin");

  const bots = [];
  for (let i = 0; i < PLAYERS; i++) {
    const bot = await signUpBot(i + 1);
    bots.push(bot);
    process.stdout.write(`\r✓ Created ${bots.length}/${PLAYERS} bot accounts`);
  }
  console.log();

  const tournament = await createTournament(adminCookie);
  console.log(`✓ Created tournament ${tournament.tournamentId} "${tournament.name}"`);

  for (const bot of bots) {
    await registerBot(tournament.tournamentId, bot.cookie);
    process.stdout.write(`\r✓ Registered bots: ${bots.indexOf(bot) + 1}/${bots.length}`);
  }
  console.log();

  const started = await startTournament(tournament.tournamentId, adminCookie);
  console.log(`✓ Started tournament (status=${started.status})`);

  if (ADVANCE) {
    let descriptor;
    if (ADVANCE === "half" || ADVANCE === "all-but-last") {
      descriptor = ADVANCE;
    } else {
      const n = Number.parseInt(ADVANCE, 10);
      if (!Number.isFinite(n) || n < 1) {
        console.error(`Invalid --advance "${ADVANCE}"`);
        process.exit(1);
      }
      descriptor = n;
    }
    console.log(`▶ Advancing: ${descriptor}`);
    await advance(tournament.tournamentId, adminCookie, descriptor);
    console.log("✓ Done advancing");
  }

  console.log();
  console.log(`🎯 Tournament URL: ${BASE_URL}/tournament/${tournament.tournamentId}`);
}

main().catch((err) => {
  console.error("\n✗ seed-tournament failed:", err.message || err);
  process.exit(1);
});
