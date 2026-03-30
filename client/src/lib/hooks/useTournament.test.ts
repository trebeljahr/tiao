import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTournament } from "./useTournament";
import type { AuthResponse, TournamentSnapshot } from "@shared";

// --- Mocks ---

let lobbyMessageCallback: ((payload: any) => void) | null = null;

vi.mock("@/lib/LobbySocketContext", () => ({
  useLobbyMessage: (cb: (payload: any) => void) => {
    lobbyMessageCallback = cb;
  },
}));

const mockGetTournament = vi.fn();

vi.mock("@/lib/api", () => ({
  getTournament: (...args: any[]) => mockGetTournament(...args),
}));

// --- Helpers ---

const mockAuth: AuthResponse = {
  player: {
    kind: "account",
    playerId: "player-1",
    displayName: "Test User",
  },
};

function makeTournamentSnapshot(overrides?: Partial<TournamentSnapshot>): TournamentSnapshot {
  return {
    tournamentId: "T001",
    name: "Test Tournament",
    creatorId: "player-1",
    status: "active",
    settings: {
      format: "single-elimination",
      timeControl: null,
      scheduling: "simultaneous",
      noShow: { type: "auto-forfeit", timeoutMs: 60_000 },
      visibility: "public",
      minPlayers: 2,
      maxPlayers: 16,
    },
    participants: [
      { playerId: "player-1", displayName: "Test User", seed: 1, status: "active" },
      { playerId: "player-2", displayName: "Opponent", seed: 2, status: "active" },
    ],
    rounds: [
      {
        roundIndex: 0,
        label: "Round 1",
        status: "active",
        matches: [
          {
            matchId: "R0M0",
            roundIndex: 0,
            matchIndex: 0,
            players: [
              { playerId: "player-1", displayName: "Test User", seed: 1 },
              { playerId: "player-2", displayName: "Opponent", seed: 2 },
            ],
            roomId: "room-1",
            winner: null,
            score: [0, 0],
            status: "active",
          },
        ],
      },
    ],
    groups: [],
    knockoutRounds: [],
    featuredMatchId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// --- Tests ---

describe("useTournament — #89 tournament live scores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lobbyMessageCallback = null;
  });

  it("updates match score in local state on tournament-score-update message", async () => {
    const snapshot = makeTournamentSnapshot();
    mockGetTournament.mockResolvedValue({ tournament: snapshot });

    const { result } = renderHook(() => useTournament(mockAuth, "T001"));

    // Wait for initial fetch
    await vi.waitFor(() => {
      expect(result.current.tournament).not.toBeNull();
    });

    expect(result.current.tournament!.rounds[0].matches[0].score).toEqual([0, 0]);

    // Simulate a live score update via lobby socket
    act(() => {
      lobbyMessageCallback?.({
        type: "tournament-score-update",
        tournamentId: "T001",
        matchId: "R0M0",
        score: [3, 1],
      });
    });

    // The hook should update the match score in local state without refetching
    expect(result.current.tournament!.rounds[0].matches[0].score).toEqual([3, 1]);
  });

  it("updates group-stage match scores on tournament-score-update", async () => {
    const snapshot = makeTournamentSnapshot({
      rounds: [],
      groups: [
        {
          groupId: "G0",
          label: "Group A",
          participantIds: ["player-1", "player-2"],
          rounds: [
            {
              roundIndex: 0,
              label: "Round 1",
              status: "active",
              matches: [
                {
                  matchId: "G0R0M0",
                  roundIndex: 0,
                  matchIndex: 0,
                  groupId: "G0",
                  players: [
                    { playerId: "player-1", displayName: "Test User", seed: 1 },
                    { playerId: "player-2", displayName: "Opponent", seed: 2 },
                  ],
                  roomId: "room-1",
                  winner: null,
                  score: [0, 0],
                  status: "active",
                },
              ],
            },
          ],
          standings: [],
        },
      ],
    });
    mockGetTournament.mockResolvedValue({ tournament: snapshot });

    const { result } = renderHook(() => useTournament(mockAuth, "T001"));

    await vi.waitFor(() => {
      expect(result.current.tournament).not.toBeNull();
    });

    // Simulate live score update for a group-stage match
    act(() => {
      lobbyMessageCallback?.({
        type: "tournament-score-update",
        tournamentId: "T001",
        matchId: "G0R0M0",
        score: [2, 4],
      });
    });

    // Should update the group-stage match score
    const groupMatch = result.current.tournament!.groups[0].rounds[0].matches[0];
    expect(groupMatch.score).toEqual([2, 4]);
  });

  it("ignores tournament-score-update for a different tournament", async () => {
    const snapshot = makeTournamentSnapshot();
    mockGetTournament.mockResolvedValue({ tournament: snapshot });

    const { result } = renderHook(() => useTournament(mockAuth, "T001"));

    await vi.waitFor(() => {
      expect(result.current.tournament).not.toBeNull();
    });

    // Score update for a different tournament
    act(() => {
      lobbyMessageCallback?.({
        type: "tournament-score-update",
        tournamentId: "OTHER",
        matchId: "R0M0",
        score: [5, 5],
      });
    });

    // Score should remain unchanged
    expect(result.current.tournament!.rounds[0].matches[0].score).toEqual([0, 0]);
  });
});
