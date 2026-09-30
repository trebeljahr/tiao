"use client";

import { createInitialGameState, type TournamentListItem } from "@shared";
import { useTranslations } from "next-intl";
import { TiaoBoard } from "@/components/game/TiaoBoard";
import { PlayerIdentityRow } from "@/components/PlayerIdentityRow";
import { TournamentCard } from "@/components/tournament/TournamentCard";
import { HERO_FRAMES } from "./heroGame";
import styles from "./PublicSite.module.css";

// Reuse a settled position from the recorded game, with no pending captures.
const frame =
  HERO_FRAMES.find(
    (candidate) =>
      candidate.stones.length >= 24 && candidate.stones.every((stone) => !stone.captured),
  ) ?? HERO_FRAMES[8];
const sampleGame = createInitialGameState();
for (const stone of frame.stones) sampleGame.positions[stone.y][stone.x] = stone.color;
sampleGame.currentTurn = frame.turn;
sampleGame.score = { white: frame.score[0], black: frame.score[1] };

export function MatchPreview() {
  return (
    <figure className={styles.matchPreview}>
      <div inert>
        <TiaoBoard state={sampleGame} selectedPiece={null} jumpTargets={[]} disabled />
      </div>
    </figure>
  );
}

export function CommunityPreview() {
  const t = useTranslations("landing");
  const tournament: TournamentListItem = {
    tournamentId: "homepage-example",
    name: t("sampleTournament"),
    creatorId: "example-mira",
    creatorDisplayName: "Mira",
    status: "registration",
    format: "round-robin",
    visibility: "public",
    playerCount: 6,
    maxPlayers: 8,
    timeControl: null,
    boardSize: 19,
    scoreToWin: 10,
    isFeatured: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
  return (
    <figure className={styles.playerPreview}>
      <div className={styles.communityPreview} inert>
        <div className={styles.samplePlayers}>
          <PlayerIdentityRow
            player={{ displayName: "Mira", rating: 1540 }}
            online
            linkToProfile={false}
            showFriendBadge
          />
          <PlayerIdentityRow
            player={{ displayName: "Aki", rating: 1480 }}
            online
            linkToProfile={false}
            showFriendBadge
          />
        </div>
        <TournamentCard item={tournament} onClick={() => {}} />
      </div>
    </figure>
  );
}
