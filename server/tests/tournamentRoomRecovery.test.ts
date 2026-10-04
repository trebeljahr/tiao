import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlayerIdentity } from "../../shared/src";
import { GameService } from "../game/gameService";
import { InMemoryGameRoomStore } from "../game/gameStore";

test("concurrent tournament linkage retries recover one committed room", async () => {
  const store = new InMemoryGameRoomStore();
  const services = [new GameService(store), new GameService(store)];
  const player = (playerId: string): PlayerIdentity => ({
    playerId,
    displayName: playerId,
    kind: "guest",
  });
  try {
    const rooms = await Promise.all(
      services.map((service) =>
        service.createTournamentGame(player("a"), player("b"), null, "tournament", "round-one"),
      ),
    );
    assert.equal(rooms[0].id, rooms[1].id);
    assert.equal((await store.listRoomsForPlayer("a")).length, 1);
    const retry = await services[1].createTournamentGame(
      player("a"),
      player("b"),
      null,
      "tournament",
      "round-one",
    );
    assert.equal(retry.id, rooms[0].id);
    assert.equal(retry.tournamentId, "tournament");
    assert.equal(retry.tournamentMatchId, "round-one");
  } finally {
    for (const service of services) await service.close();
  }
});
