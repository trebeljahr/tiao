import { cn } from "@/lib/utils";
import type { TournamentRound } from "@shared";
import { useTranslations } from "next-intl";
import { MatchCard } from "./MatchCard";

// Width of the connector space reserved on the left/right of each match
// wrapper. Matches sit between these margins and the connector lines are
// absolutely-positioned inside them.
const CONNECTOR_WIDTH = 24;
// Minimum vertical space allocated to a match in the first (largest) round.
// All rounds share the same total column height, so later rounds get
// progressively more space per match — that's exactly what centers each
// next-round match between its two feeders.
const MATCH_SLOT_HEIGHT = 168;
// Shared Tailwind utility for connector line color / thickness.
const LINE_CLASS = "bg-[#b98d49]/55 pointer-events-none";

/**
 * Map a round-from-the-end index to a label like "Final", "Semifinals",
 * etc. Uses the existing tournament translation keys. Falls back to
 * "Round N" for early rounds without dedicated names.
 */
function useRoundLabelFn(rounds: TournamentRound[]) {
  const t = useTranslations("tournament");
  return (rIdx: number) => {
    const fromEnd = rounds.length - 1 - rIdx;
    if (fromEnd === 0) return t("final");
    if (fromEnd === 1) return t("semifinals");
    if (fromEnd === 2) return t("quarterfinals");
    return t("roundN", { n: rIdx + 1 });
  };
}

/**
 * Flow-diagram bracket: rounds are columns (first round on the left, final
 * on the right). Matches within a round are stacked vertically with equal
 * flex, so all columns share the same total height. Because each round has
 * half the matches of the previous one, the `flex-1` distribution
 * automatically centers each round N+1 match between its two round N
 * feeders. Connector lines are drawn via absolutely-positioned borders on
 * each match wrapper — upper match of a pair draws the top half of the
 * bracket, lower match draws the bottom half.
 */
export function BracketVisualization({
  rounds,
  currentPlayerId,
  featuredMatchId,
}: {
  rounds: TournamentRound[];
  currentPlayerId?: string;
  featuredMatchId?: string | null;
}) {
  const labelFor = useRoundLabelFn(rounds);

  if (rounds.length === 0) {
    return <p className="text-sm text-muted-foreground">No bracket data available yet.</p>;
  }

  // Tall enough to give round 1 matches a reasonable vertical slot. All
  // later rounds inherit this height via flex, so their matches spread out
  // to align with the midpoints of their feeders.
  const maxMatches = Math.max(...rounds.map((r) => r.matches.length));
  const minHeight = maxMatches * MATCH_SLOT_HEIGHT;

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-fit pb-4" style={{ minHeight }}>
        {rounds.map((round, rIdx) => {
          const isFirst = rIdx === 0;
          const isLast = rIdx === rounds.length - 1;
          const roundLabel = labelFor(rIdx);
          return (
            <div key={round.roundIndex} className="flex flex-col min-w-[280px] shrink-0">
              <h4 className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {roundLabel}
              </h4>
              <div className="flex flex-1 flex-col">
                {round.matches.map((match, mIdx) => {
                  const isUpperOfPair = mIdx % 2 === 0;
                  const isLastMatchInRound = mIdx === round.matches.length - 1;
                  // Odd-count rounds (byes at the end) skip the vertical
                  // connector for the unpaired last match — there's no
                  // sibling to join.
                  const skipVertical = isUpperOfPair && isLastMatchInRound;
                  return (
                    <div key={match.matchId} className="relative flex flex-1 items-center min-h-0">
                      <div
                        // py-2 reserves vertical breathing room between
                        // adjacent matches inside the same column. The
                        // match card itself is centered in the slot via
                        // the parent's items-center, so this padding ends
                        // up split as gap above and below.
                        className="flex-1 py-2"
                        style={{
                          marginLeft: isFirst ? 8 : CONNECTOR_WIDTH + 8,
                          marginRight: isLast ? 8 : CONNECTOR_WIDTH + 8,
                        }}
                      >
                        <MatchCard
                          match={match}
                          currentPlayerId={currentPlayerId}
                          featured={match.matchId === featuredMatchId}
                          roundLabel={roundLabel}
                        />
                      </div>

                      {/* Incoming horizontal line from previous round */}
                      {!isFirst && (
                        <div
                          className={cn("absolute top-1/2 h-px", LINE_CLASS)}
                          style={{ left: 0, width: CONNECTOR_WIDTH + 8 }}
                        />
                      )}

                      {/* Outgoing L-shape toward next round */}
                      {!isLast && (
                        <>
                          {/* Horizontal stub from the match edge to the column right */}
                          <div
                            className={cn("absolute top-1/2 h-px", LINE_CLASS)}
                            style={{ right: 0, width: CONNECTOR_WIDTH + 8 }}
                          />
                          {/* Vertical segment joining the pair midpoint:
                              upper goes from 50% down to 100% of its slot,
                              lower goes from 0% down to 50% of its slot.
                              Together they form a single vertical line from
                              upper match center through the pair midpoint to
                              lower match center. */}
                          {!skipVertical && (
                            <div
                              className={cn("absolute w-px", LINE_CLASS)}
                              style={
                                isUpperOfPair
                                  ? { right: 0, top: "50%", bottom: 0 }
                                  : { right: 0, top: 0, bottom: "50%" }
                              }
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
