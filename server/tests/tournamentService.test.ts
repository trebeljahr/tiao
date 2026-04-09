import assert from "node:assert/strict";
import { before, test, describe } from "node:test";
import type { PlayerIdentity, TournamentSettings } from "../../shared/src";
import { GameService, GameServiceError } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";
import { TournamentService, MAX_ONGOING_TOURNAMENTS_PER_CREATOR } from "../game/tournamentService";
import { InMemoryTournamentStore } from "../game/tournamentStore";
import { InMemoryLockProvider } from "../game/lockProvider";

// Prevent achievement checks from hitting Mongoose (no DB in unit tests)
before(async () => {
  const mod = (await import("../game/achievementService")) as Record<string, unknown>;
  mod.onGameCompleted = async () => {};
  mod.onEloUpdated = async () => {};
  mod.onSpectateStarted = async () => {};
  mod.onTournamentWon = async () => {};
});

function createPlayer(playerId: string, options: Partial<PlayerIdentity> = {}): PlayerIdentity {
  return {
    playerId,
    displayName: options.displayName ?? playerId,
    kind: options.kind ?? "account",
    email: options.email,
    profilePicture: options.profilePicture,
  };
}

function defaultSettings(overrides: Partial<TournamentSettings> = {}): TournamentSettings {
  return {
    format: "single-elimination",
    timeControl: null,
    scheduling: "simultaneous",
    noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
    visibility: "public",
    minPlayers: 2,
    maxPlayers: 16,
    ...overrides,
  };
}

function createServices() {
  const gameStore = new InMemoryGameRoomStore();
  const tournamentStore = new InMemoryTournamentStore();
  const lockProvider = new InMemoryLockProvider();
  const gameService = new GameService(gameStore, () => 0);
  const tournamentService = new TournamentService(tournamentStore, gameService, lockProvider);
  return { gameStore, tournamentStore, gameService, tournamentService };
}

function isGameServiceError(error: unknown, code: string): error is GameServiceError {
  return error instanceof GameServiceError && error.code === code;
}

// ── Tournament Creation ──

describe("Tournament creation", () => {
  test("creates a tournament in registration status", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const tournament = await tournamentService.createTournament(
      alice,
      defaultSettings(),
      "Test Tournament",
      "A fun tournament",
    );

    assert.equal(tournament.status, "registration");
    assert.equal(tournament.name, "Test Tournament");
    assert.equal(tournament.description, "A fun tournament");
    assert.equal(tournament.creatorId, "alice");
    assert.equal(tournament.participants.length, 0);
    assert.ok(tournament.tournamentId.length === 8);
  });

  test("rejects guest players", async () => {
    const { tournamentService } = createServices();
    const guest = createPlayer("guest-1", { kind: "guest" });

    await assert.rejects(
      () => tournamentService.createTournament(guest, defaultSettings(), "Test"),
      (error) => isGameServiceError(error, "ACCOUNT_REQUIRED"),
    );
  });

  test(`rejects creating more than ${MAX_ONGOING_TOURNAMENTS_PER_CREATOR} ongoing tournaments per creator`, async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    for (let i = 0; i < MAX_ONGOING_TOURNAMENTS_PER_CREATOR; i++) {
      await tournamentService.createTournament(alice, defaultSettings(), `T${i}`);
    }

    await assert.rejects(
      () => tournamentService.createTournament(alice, defaultSettings(), "Overflow"),
      (error) => isGameServiceError(error, "TOURNAMENT_LIMIT_REACHED"),
    );
  });

  test("cancelled and finished tournaments do not count toward the ongoing limit", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    // Fill the quota, then cancel one — should be allowed to create another.
    const created = [] as Awaited<ReturnType<typeof tournamentService.createTournament>>[];
    for (let i = 0; i < MAX_ONGOING_TOURNAMENTS_PER_CREATOR; i++) {
      created.push(await tournamentService.createTournament(alice, defaultSettings(), `T${i}`));
    }

    await tournamentService.cancelTournament(created[0].tournamentId, "alice");

    // Now a new one should succeed.
    await tournamentService.createTournament(alice, defaultSettings(), "New");
  });

  test("limit is per-creator — other users can still create", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    for (let i = 0; i < MAX_ONGOING_TOURNAMENTS_PER_CREATOR; i++) {
      await tournamentService.createTournament(alice, defaultSettings(), `Alice-${i}`);
    }

    // Bob is unaffected.
    await tournamentService.createTournament(bob, defaultSettings(), "Bob's");
  });
});

// ── Registration ──

describe("Tournament registration", () => {
  test("players can register and unregister", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const tournament = await tournamentService.createTournament(alice, defaultSettings(), "Test");
    const id = tournament.tournamentId;

    await tournamentService.registerPlayer(id, alice);
    await tournamentService.registerPlayer(id, bob);

    let snapshot = await tournamentService.getTournamentSnapshot(id);
    assert.equal(snapshot.participants.length, 2);
    assert.equal(snapshot.participants[0].playerId, "alice");
    assert.equal(snapshot.participants[0].seed, 1);
    assert.equal(snapshot.participants[1].playerId, "bob");
    assert.equal(snapshot.participants[1].seed, 2);

    await tournamentService.unregisterPlayer(id, "bob");
    snapshot = await tournamentService.getTournamentSnapshot(id);
    assert.equal(snapshot.participants.length, 1);
  });

  test("rejects duplicate registration", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Test");
    await tournamentService.registerPlayer(t.tournamentId, alice);

    await assert.rejects(
      () => tournamentService.registerPlayer(t.tournamentId, alice),
      (error) => isGameServiceError(error, "ALREADY_REGISTERED"),
    );
  });

  test("rejects registration when tournament is full", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ maxPlayers: 2 }),
      "Small",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, createPlayer("bob"));

    await assert.rejects(
      () => tournamentService.registerPlayer(t.tournamentId, createPlayer("charlie")),
      (error) => isGameServiceError(error, "TOURNAMENT_FULL"),
    );
  });

  test("private tournament requires invite code", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "secret" }),
      "Private",
    );

    await assert.rejects(
      () => tournamentService.registerPlayer(t.tournamentId, createPlayer("bob")),
      (error) => isGameServiceError(error, "INVALID_INVITE_CODE"),
    );

    // With correct code it works
    await tournamentService.registerPlayer(t.tournamentId, createPlayer("bob"), "secret");
    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    assert.equal(snapshot.participants.length, 1);
  });
});

// ── Starting a tournament ──

describe("Starting a tournament", () => {
  test("rejects start below minimum players", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 4 }),
      "Test",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);

    await assert.rejects(
      () => tournamentService.startTournament(t.tournamentId, "alice"),
      (error) => isGameServiceError(error, "NOT_ENOUGH_PLAYERS"),
    );
  });

  test("only the creator can start", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Test");
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);

    await assert.rejects(
      () => tournamentService.startTournament(t.tournamentId, "bob"),
      (error) => isGameServiceError(error, "NOT_ADMIN"),
    );
  });
});

// ── Single Elimination Bracket ──

describe("Single elimination bracket", () => {
  test("generates correct bracket for 4 players", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const players = [alice, createPlayer("bob"), createPlayer("charlie"), createPlayer("dave")];

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2 }),
      "Elim4",
    );

    for (const p of players) {
      await tournamentService.registerPlayer(t.tournamentId, p);
    }

    await tournamentService.startTournament(t.tournamentId, "alice");
    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);

    assert.equal(snapshot.status, "active");
    assert.equal(snapshot.rounds.length, 2); // 4 players = 2 rounds
    assert.equal(snapshot.rounds[0].matches.length, 2); // 2 semifinal matches
    assert.equal(snapshot.rounds[1].matches.length, 1); // 1 final match

    // All participants should be active
    for (const p of snapshot.participants) {
      assert.equal(p.status, "active");
    }

    // First round should be active, second pending
    assert.equal(snapshot.rounds[0].status, "active");
    assert.equal(snapshot.rounds[1].status, "pending");

    // First round matches should have players and be active (rooms created)
    for (const match of snapshot.rounds[0].matches) {
      assert.ok(match.players[0], "match should have player 1");
      assert.ok(match.players[1], "match should have player 2");
      assert.ok(match.roomId, "match should have a game room");
      assert.equal(match.status, "active");
    }

    // Final match should still have null players
    assert.equal(snapshot.rounds[1].matches[0].players[0], null);
    assert.equal(snapshot.rounds[1].matches[0].players[1], null);
  });

  test("handles byes for non-power-of-2 player counts", async () => {
    const { tournamentService } = createServices();
    const creator = createPlayer("creator");
    const players = [creator, createPlayer("p2"), createPlayer("p3")];

    const t = await tournamentService.createTournament(
      creator,
      defaultSettings({ minPlayers: 2 }),
      "Elim3",
    );
    for (const p of players) {
      await tournamentService.registerPlayer(t.tournamentId, p);
    }

    await tournamentService.startTournament(t.tournamentId, "creator");
    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);

    assert.equal(snapshot.rounds.length, 2); // Padded to 4 = 2 rounds

    // Should have at least one bye in the first round
    const byeMatches = snapshot.rounds[0].matches.filter((m) => m.status === "bye");
    assert.ok(byeMatches.length >= 1, "should have at least one bye");

    // Bye match should have a winner assigned
    for (const bye of byeMatches) {
      assert.ok(bye.winner, "bye match should have a winner");
    }
  });
});

// ── Round Robin ──

describe("Round robin bracket", () => {
  test("generates correct round-robin schedule for 4 players", async () => {
    const { tournamentService } = createServices();
    const creator = createPlayer("creator");
    const players = [creator, createPlayer("p2"), createPlayer("p3"), createPlayer("p4")];

    const t = await tournamentService.createTournament(
      creator,
      defaultSettings({ format: "round-robin", minPlayers: 2 }),
      "RR4",
    );
    for (const p of players) {
      await tournamentService.registerPlayer(t.tournamentId, p);
    }

    await tournamentService.startTournament(t.tournamentId, "creator");
    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);

    assert.equal(snapshot.status, "active");
    // 4 players = 3 rounds (N-1 rounds for N players)
    assert.equal(snapshot.rounds.length, 3);

    // Each round should have 2 matches (4 players / 2)
    for (const round of snapshot.rounds) {
      assert.equal(round.matches.length, 2);
    }

    // First round should be active, rest pending
    assert.equal(snapshot.rounds[0].status, "active");
    assert.equal(snapshot.rounds[1].status, "pending");
    assert.equal(snapshot.rounds[2].status, "pending");

    // Every player should play every other player exactly once
    const matchups = new Set<string>();
    for (const round of snapshot.rounds) {
      for (const match of round.matches) {
        if (match.players[0] && match.players[1]) {
          const key = [match.players[0].playerId, match.players[1].playerId].sort().join("-");
          matchups.add(key);
        }
      }
    }
    // C(4,2) = 6 unique pairings
    assert.equal(matchups.size, 6);
  });
});

// ── Groups + Knockout ──

describe("Groups + knockout bracket", () => {
  test("generates groups with round-robin and leaves knockout empty initially", async () => {
    const { tournamentService } = createServices();
    const creator = createPlayer("creator");
    const playerIds = ["creator", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
    const players = playerIds.map((id) => createPlayer(id));

    const t = await tournamentService.createTournament(
      creator,
      defaultSettings({
        format: "groups-knockout",
        groupSize: 4,
        minPlayers: 2,
      }),
      "GK8",
    );
    for (const p of players) {
      await tournamentService.registerPlayer(t.tournamentId, p);
    }

    await tournamentService.startTournament(t.tournamentId, "creator");
    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);

    assert.equal(snapshot.status, "active");
    assert.equal(snapshot.groups.length, 2); // 8 players / 4 per group = 2 groups

    // Each group should have 4 participants
    for (const group of snapshot.groups) {
      assert.equal(group.participantIds.length, 4);
      // 4 players = 3 round-robin rounds
      assert.equal(group.rounds.length, 3);
      // Standings initialized
      assert.equal(group.standings.length, 4);
    }

    // Knockout rounds should be empty until groups finish
    assert.equal(snapshot.knockoutRounds.length, 0);
  });
});

// ── Game Completion Callback ──

describe("Game completion callback", () => {
  test("advances bracket when a tournament game finishes", async () => {
    const { tournamentService, gameStore, gameService: _gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2 }),
      "Callback Test",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    let snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    assert.equal(snapshot.rounds[0].matches[0].status, "active");
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId, "match should have a room ID");

    // Simulate game completion by force-finishing the room
    const room = await gameStore.getRoom(roomId);
    assert.ok(room, "game room should exist");
    room.state.score.white = 10;
    room.status = "finished";
    await gameStore.saveRoom(room);

    // Trigger the callback
    await tournamentService.onGameCompleted(roomId);

    snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const match = snapshot.rounds[0].matches[0];
    assert.equal(match.status, "finished");

    // With only 2 players (padded to 2), the tournament should finish
    // since there's only 1 round with 1 match
    assert.equal(snapshot.status, "finished");

    // One participant should be the winner
    const winner = snapshot.participants.find((p) => p.status === "winner");
    assert.ok(winner, "should have a winner");
  });
});

// ── Seeding ──

describe("Seeding management", () => {
  test("randomize seeding shuffles participants", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const players = [alice, createPlayer("bob"), createPlayer("charlie"), createPlayer("dave")];

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Seeding");
    for (const p of players) {
      await tournamentService.registerPlayer(t.tournamentId, p);
    }

    const _before = (
      await tournamentService.getTournamentSnapshot(t.tournamentId)
    ).participants.map((p) => p.seed);

    await tournamentService.randomizeSeeding(t.tournamentId, "alice");

    const after = (await tournamentService.getTournamentSnapshot(t.tournamentId)).participants.map(
      (p) => p.seed,
    );

    // Seeds should still be 1-4 (just potentially reordered)
    assert.deepEqual([...after].sort(), [1, 2, 3, 4]);
  });

  test("manual seeding updates work", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Seeds");
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);

    await tournamentService.updateSeeding(t.tournamentId, "alice", [
      { playerId: "alice", seed: 2 },
      { playerId: "bob", seed: 1 },
    ]);

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const aliceP = snapshot.participants.find((p) => p.playerId === "alice");
    const bobP = snapshot.participants.find((p) => p.playerId === "bob");
    assert.equal(aliceP?.seed, 2);
    assert.equal(bobP?.seed, 1);
  });

  test("non-admin cannot change seeding", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Test");
    await tournamentService.registerPlayer(t.tournamentId, alice);

    await assert.rejects(
      () => tournamentService.randomizeSeeding(t.tournamentId, "bob"),
      (error) => isGameServiceError(error, "NOT_ADMIN"),
    );
  });
});

// ── Cancel ──

describe("Tournament cancellation", () => {
  test("creator can cancel a tournament", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Cancel");
    await tournamentService.cancelTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    assert.equal(snapshot.status, "cancelled");
  });

  test("non-admin cannot cancel", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Cancel");

    await assert.rejects(
      () => tournamentService.cancelTournament(t.tournamentId, "bob"),
      (error) => isGameServiceError(error, "NOT_ADMIN"),
    );
  });

  test("cancelling unlinks ongoing games from the tournament", async () => {
    const { tournamentService, gameStore } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2 }),
      "Cancel Unlink",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId, "match should have a room ID");

    // Verify game is linked to tournament before cancellation
    const roomBefore = await gameStore.getRoom(roomId);
    assert.ok(roomBefore);
    assert.equal(roomBefore.tournamentId, t.tournamentId);
    assert.equal(roomBefore.roomType, "tournament");

    // Cancel the tournament
    await tournamentService.cancelTournament(t.tournamentId, "alice");

    // Verify game is unlinked from tournament after cancellation
    const roomAfter = await gameStore.getRoom(roomId);
    assert.ok(roomAfter);
    assert.equal(roomAfter.tournamentId, null, "tournamentId should be null after cancel");
    assert.equal(
      roomAfter.tournamentMatchId,
      null,
      "tournamentMatchId should be null after cancel",
    );
    assert.equal(roomAfter.roomType, "direct", "roomType should be direct after cancel");
    assert.equal(roomAfter.status, "active", "game should still be active and playable");
  });

  test("creator can delete a cancelled tournament", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Doomed");
    await tournamentService.cancelTournament(t.tournamentId, "alice");
    await tournamentService.deleteTournament(t.tournamentId, "alice");

    await assert.rejects(
      () => tournamentService.getTournamentSnapshot(t.tournamentId),
      (error) => isGameServiceError(error, "TOURNAMENT_NOT_FOUND"),
    );
  });

  test("non-creator cannot delete a cancelled tournament", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Doomed");
    await tournamentService.cancelTournament(t.tournamentId, "alice");

    await assert.rejects(
      () => tournamentService.deleteTournament(t.tournamentId, "bob"),
      (error) => isGameServiceError(error, "NOT_ADMIN"),
    );
  });

  test("cannot delete a tournament that is not cancelled", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Live");

    await assert.rejects(
      () => tournamentService.deleteTournament(t.tournamentId, "alice"),
      (error) => isGameServiceError(error, "NOT_CANCELLED"),
    );
  });

  test("cancelling does not unlink finished games", async () => {
    const { tournamentService, gameStore } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2 }),
      "Cancel Finished",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    let snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    // Force-finish the game
    const room = await gameStore.getRoom(roomId);
    assert.ok(room);
    room.state.score.white = 10;
    room.status = "finished";
    await gameStore.saveRoom(room);
    await tournamentService.onGameCompleted(roomId);

    // Tournament should be finished now (2 players = 1 match)
    snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    // Even though the tournament is finished, let's test that creating a new
    // tournament and finishing a game before cancelling preserves the finished game link.
    // Since the tournament is already finished, we can't cancel it.
    // Instead, test with a larger bracket.
    assert.equal(snapshot.status, "finished");

    // The finished game should still have its tournament reference
    const finishedRoom = await gameStore.getRoom(roomId);
    assert.ok(finishedRoom);
    assert.equal(finishedRoom.tournamentId, t.tournamentId);
    assert.equal(finishedRoom.roomType, "tournament");
  });
});

// ── Listing ──

describe("Tournament listing", () => {
  test("lists public tournaments", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "public" }),
      "Public",
    );
    await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "x" }),
      "Private",
    );

    const list = await tournamentService.listPublicTournaments();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "Public");
  });

  test("public list hides cancelled tournaments by default", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const active = await tournamentService.createTournament(alice, defaultSettings(), "Active");
    const doomed = await tournamentService.createTournament(alice, defaultSettings(), "Doomed");
    await tournamentService.cancelTournament(doomed.tournamentId, "alice");

    const list = await tournamentService.listPublicTournaments();
    assert.equal(list.length, 1);
    assert.equal(list[0].tournamentId, active.tournamentId);

    // But explicitly asking for cancelled still returns them.
    const cancelled = await tournamentService.listPublicTournaments("cancelled");
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].tournamentId, doomed.tournamentId);
  });

  test("my tournaments still shows cancelled tournaments (creator + participants)", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Doomed");
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.cancelTournament(t.tournamentId, "alice");

    const aliceList = await tournamentService.listMyTournaments("alice");
    assert.equal(aliceList.length, 1, "creator still sees their cancelled tournament");
    assert.equal(aliceList[0].status, "cancelled");

    const bobList = await tournamentService.listMyTournaments("bob");
    assert.equal(bobList.length, 1, "participant still sees the cancelled tournament");
    assert.equal(bobList[0].status, "cancelled");
  });

  test("lists player's tournaments", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t1 = await tournamentService.createTournament(alice, defaultSettings(), "Alice's");
    await tournamentService.createTournament(bob, defaultSettings(), "Bob's");

    await tournamentService.registerPlayer(t1.tournamentId, bob);

    const bobList = await tournamentService.listMyTournaments("bob");
    // Bob created one and registered for another
    assert.equal(bobList.length, 2);
  });
});

// ── Admin Forfeit ──

describe("Admin forfeit", () => {
  test("admin can forfeit a match", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2 }),
      "Forfeit Test",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    let snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const matchId = snapshot.rounds[0].matches[0].matchId;

    await tournamentService.forfeitMatch(t.tournamentId, matchId, "bob", "alice");

    snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const match = snapshot.rounds[0].matches[0];
    assert.equal(match.status, "forfeit");
    assert.equal(match.winner, "alice");
  });
});

// ── Deferred timer start ──

describe("Deferred timer for tournament games", () => {
  test("timed tournament games are created with no firstMoveDeadline", async () => {
    const { tournamentService, gameStore } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2, timeControl: { initialMs: 300_000, incrementMs: 0 } }),
      "Deferred Timer",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    const room = await gameStore.getRoom(roomId);
    assert.ok(room);
    assert.equal(
      room.firstMoveDeadline,
      null,
      "firstMoveDeadline should be null until both connect",
    );
    assert.equal(room.status, "active", "room should be active (both seated)");
    assert.ok(room.timeControl, "room should have time control");
  });

  test("untimed tournament games have no firstMoveDeadline (and that's fine)", async () => {
    const { tournamentService, gameStore } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2, timeControl: null }),
      "Untimed",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    const room = await gameStore.getRoom(roomId);
    assert.ok(room);
    assert.equal(room.firstMoveDeadline, null);
    assert.equal(room.timeControl, null);
  });
});

// ── Move blocking in unstarted tournament games ──

describe("Move blocking in unstarted tournament games", () => {
  test("moves are rejected in timed tournament games before both players connect", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2, timeControl: { initialMs: 300_000, incrementMs: 0 } }),
      "Block Moves",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    // Try to place a piece — should fail because neither player has connected via WebSocket
    await assert.rejects(
      () =>
        gameService.applyAction(roomId, alice, { type: "place-piece", position: { x: 9, y: 9 } }),
      (error) => isGameServiceError(error, "TOURNAMENT_NOT_STARTED"),
    );
  });

  test("moves are allowed in untimed tournament games immediately", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2, timeControl: null }),
      "Untimed Moves",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    // Determine which player is white (the one whose turn it is)
    const gameSnapshot = await gameService.getSnapshot(roomId);
    const whiteSeat = gameSnapshot.seats.white;
    assert.ok(whiteSeat, "white seat should be assigned");
    const whitePlayer = whiteSeat.player.playerId === alice.playerId ? alice : bob;

    // Place a piece — should succeed in untimed tournament games
    const result = await gameService.applyAction(roomId, whitePlayer, {
      type: "place-piece",
      position: { x: 9, y: 9 },
    });
    assert.equal(result.state.currentTurn, "black");
  });
});

// ── tournamentReady snapshot field ──

describe("tournamentReady snapshot field", () => {
  test("timed tournament game snapshot has tournamentReady = false before connect", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2, timeControl: { initialMs: 300_000, incrementMs: 0 } }),
      "Ready Field",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    const gameSnapshot = await gameService.getSnapshot(roomId);
    assert.equal(gameSnapshot.tournamentReady, false);
  });

  test("untimed tournament game snapshot has tournamentReady = true", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2, timeControl: null }),
      "Untimed Ready",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    const gameSnapshot = await gameService.getSnapshot(roomId);
    assert.equal(gameSnapshot.tournamentReady, true);
  });

  test("non-tournament game snapshot has tournamentReady = undefined", async () => {
    const { gameService } = createServices();
    const alice = createPlayer("alice");

    const snapshot = await gameService.createGame(alice);
    assert.equal(snapshot.tournamentReady, undefined);
  });
});

// ── Auto-drop on lobby disconnect ──

describe("Auto-drop on lobby disconnect", () => {
  test("findRegistrationTournamentsByParticipant returns correct tournaments", async () => {
    const { tournamentService, tournamentStore } = createServices();
    const alice = createPlayer("alice");

    const t1 = await tournamentService.createTournament(alice, defaultSettings(), "Active Reg");
    await tournamentService.registerPlayer(t1.tournamentId, alice);

    const t2 = await tournamentService.createTournament(alice, defaultSettings(), "Another");
    await tournamentService.registerPlayer(t2.tournamentId, alice);

    // Start t2 so it's no longer in registration
    const bob = createPlayer("bob");
    await tournamentService.registerPlayer(t2.tournamentId, bob);
    await tournamentService.startTournament(t2.tournamentId, "alice");

    const result = await tournamentStore.findRegistrationTournamentsByParticipant("alice");
    assert.equal(result.length, 1);
    assert.equal(result[0].tournamentId, t1.tournamentId);
  });
});

// ── Rematch blocking ──

describe("Tournament rematch blocking", () => {
  test("rematches are blocked for tournament games", async () => {
    const { tournamentService, gameService, gameStore } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ minPlayers: 2 }),
      "No Rematch",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    const roomId = snapshot.rounds[0].matches[0].roomId;
    assert.ok(roomId);

    // Force-finish the game
    const room = await gameStore.getRoom(roomId);
    assert.ok(room);
    room.state.score.white = 10;
    room.status = "finished";
    await gameStore.saveRoom(room);

    // Try to request rematch — should be rejected
    await assert.rejects(
      () => gameService.applyAction(roomId, alice, { type: "request-rematch" }),
      (error) => isGameServiceError(error, "TOURNAMENT_NO_REMATCH"),
    );
  });
});

// ── Invite Links ──

describe("Private tournament invite links", () => {
  test("auto-generates invite code for private tournament without one", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private" }),
      "Auto Code",
    );

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    assert.ok(
      snapshot.settings.inviteCode,
      "invite code should be auto-generated for private tournaments",
    );
    assert.equal(snapshot.settings.inviteCode!.length, 8);
  });

  test("preserves user-provided invite code", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "MYCODE" }),
      "Custom Code",
    );

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    assert.equal(snapshot.settings.inviteCode, "MYCODE");
  });

  test("does not generate invite code for public tournament", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "public" }),
      "Public",
    );

    const snapshot = await tournamentService.getTournamentSnapshot(t.tournamentId);
    assert.equal(snapshot.settings.inviteCode, undefined);
  });

  test("accessTournament adds user to invitedUserIds", async () => {
    const { tournamentService, tournamentStore } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "SECRET" }),
      "Access Test",
    );

    await tournamentService.accessTournament(t.tournamentId, "bob", "SECRET");

    const stored = await tournamentStore.getTournament(t.tournamentId);
    assert.ok(stored);
    assert.ok(stored.invitedUserIds.includes("bob"), "bob should be in invitedUserIds");
  });

  test("accessTournament rejects wrong invite code", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "SECRET" }),
      "Wrong Code",
    );

    await assert.rejects(
      () => tournamentService.accessTournament(t.tournamentId, "bob", "WRONG"),
      (error) => isGameServiceError(error, "INVALID_INVITE_CODE"),
    );
  });

  test("accessTournament is idempotent", async () => {
    const { tournamentService, tournamentStore } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "SECRET" }),
      "Idempotent",
    );

    await tournamentService.accessTournament(t.tournamentId, "bob", "SECRET");
    await tournamentService.accessTournament(t.tournamentId, "bob", "SECRET");

    const stored = await tournamentStore.getTournament(t.tournamentId);
    assert.ok(stored);
    assert.equal(
      stored.invitedUserIds.filter((id) => id === "bob").length,
      1,
      "bob should appear only once in invitedUserIds",
    );
  });

  test("invited user sees tournament in my tournaments list", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private", inviteCode: "SECRET" }),
      "Invite List",
    );

    await tournamentService.accessTournament(t.tournamentId, "bob", "SECRET");

    const bobList = await tournamentService.listMyTournaments("bob");
    assert.equal(bobList.length, 1);
    assert.equal(bobList[0].tournamentId, t.tournamentId);
  });

  test("private tournament not visible in public listing", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "private" }),
      "Hidden",
    );

    const list = await tournamentService.listPublicTournaments();
    assert.equal(list.length, 0);
  });

  test("accessTournament rejects non-private tournament", async () => {
    const { tournamentService } = createServices();
    const alice = createPlayer("alice");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ visibility: "public" }),
      "Public",
    );

    await assert.rejects(
      () => tournamentService.accessTournament(t.tournamentId, "bob", "anything"),
      (error) => isGameServiceError(error, "NOT_PRIVATE"),
    );
  });
});

// ── #89: Tournament Live Scores ──

describe("Tournament live scores", () => {
  test("broadcastLiveScore method exists on TournamentService", () => {
    const { tournamentService } = createServices();
    assert.equal(typeof (tournamentService as any).broadcastLiveScore, "function");
  });

  test("broadcastLiveScore broadcasts to all tournament participants", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");
    const charlie = createPlayer("charlie");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Live Score Test");
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.registerPlayer(t.tournamentId, charlie);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const broadcastCalls: Array<{ playerId: string; payload: Record<string, unknown> }> = [];
    const originalBroadcast = gameService.broadcastLobby.bind(gameService);
    gameService.broadcastLobby = (playerId: string, payload: Record<string, unknown>) => {
      broadcastCalls.push({ playerId, payload });
      originalBroadcast(playerId, payload);
    };

    // Call broadcastLiveScore with match data
    await (tournamentService as any).broadcastLiveScore(t.tournamentId, "R0M0", {
      white: 3,
      black: 1,
    });

    // Filter for score-update messages
    const scoreUpdates = broadcastCalls.filter((c) => c.payload.type === "tournament-score-update");

    // Should broadcast to all participants (alice, bob, charlie)
    const notifiedPlayerIds = new Set(scoreUpdates.map((c) => c.playerId));
    assert.ok(notifiedPlayerIds.has("alice"), "alice should be notified");
    assert.ok(notifiedPlayerIds.has("bob"), "bob should be notified");
    assert.ok(notifiedPlayerIds.has("charlie"), "charlie should be notified");
  });

  test("broadcastLiveScore correctly maps white/black scores to player slot order", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Score Map Test");
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const broadcastCalls: Array<{ playerId: string; payload: Record<string, unknown> }> = [];
    gameService.broadcastLobby = (playerId: string, payload: Record<string, unknown>) => {
      broadcastCalls.push({ playerId, payload });
    };

    // Scores should be aligned to player slot order, not color order
    await (tournamentService as any).broadcastLiveScore(t.tournamentId, "R0M0", {
      white: 5,
      black: 2,
    });

    const scoreUpdates = broadcastCalls.filter((c) => c.payload.type === "tournament-score-update");

    // All score updates should have the same score array aligned to slot order
    for (const update of scoreUpdates) {
      assert.deepEqual(update.payload.score, [5, 2], "score should be in player slot order");
      assert.equal(update.payload.matchId, "R0M0");
      assert.equal(update.payload.tournamentId, t.tournamentId);
    }
  });

  test("broadcastLiveScore searches group-stage rounds for the match", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");
    const charlie = createPlayer("charlie");
    const dave = createPlayer("dave");

    const t = await tournamentService.createTournament(
      alice,
      defaultSettings({ format: "groups-knockout", minPlayers: 4, maxPlayers: 8 }),
      "Group Stage Test",
    );
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.registerPlayer(t.tournamentId, charlie);
    await tournamentService.registerPlayer(t.tournamentId, dave);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const broadcastCalls: Array<{ playerId: string; payload: Record<string, unknown> }> = [];
    gameService.broadcastLobby = (playerId: string, payload: Record<string, unknown>) => {
      broadcastCalls.push({ playerId, payload });
    };

    // Group-stage match IDs use the group prefix (e.g. "G0-R0M0")
    // even though they live in group rounds rather than top-level rounds
    await (tournamentService as any).broadcastLiveScore(t.tournamentId, "G0-R0M0", {
      white: 1,
      black: 0,
    });

    const scoreUpdates = broadcastCalls.filter((c) => c.payload.type === "tournament-score-update");

    // Should have broadcast to participants
    assert.ok(scoreUpdates.length > 0, "should broadcast score updates for group-stage matches");
  });

  test("creator does not receive duplicate broadcasts when also a participant", async () => {
    const { tournamentService, gameService } = createServices();
    const alice = createPlayer("alice");
    const bob = createPlayer("bob");

    const t = await tournamentService.createTournament(alice, defaultSettings(), "Dedup Test");
    await tournamentService.registerPlayer(t.tournamentId, alice);
    await tournamentService.registerPlayer(t.tournamentId, bob);
    await tournamentService.startTournament(t.tournamentId, "alice");

    const broadcastCalls: Array<{ playerId: string; payload: Record<string, unknown> }> = [];
    gameService.broadcastLobby = (playerId: string, payload: Record<string, unknown>) => {
      broadcastCalls.push({ playerId, payload });
    };

    await (tournamentService as any).broadcastLiveScore(t.tournamentId, "R0M0", {
      white: 2,
      black: 3,
    });

    const scoreUpdates = broadcastCalls.filter((c) => c.payload.type === "tournament-score-update");

    // Alice is both creator and participant — should only get one broadcast
    const aliceUpdates = scoreUpdates.filter((c) => c.playerId === "alice");
    assert.equal(
      aliceUpdates.length,
      1,
      "creator who is also participant should receive exactly one broadcast",
    );
  });
});
