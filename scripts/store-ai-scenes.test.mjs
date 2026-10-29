import assert from "node:assert/strict";
import test from "node:test";
import { getWinner, isGameOver } from "../shared/src/tiao.ts";
import {
  applyDecision,
  boardHash,
  chooseScenes,
  loadMatches,
  provenance,
  validateMatch,
} from "./store-ai-scenes.mjs";

const matches = loadMatches();
test("every screenshot source is a complete legal match with shipped AI search results", () => {
  for (const match of Object.values(matches)) {
    assert.equal(match.states[0].positions.flat().filter(Boolean).length, 0);
    assert(isGameOver(match.states.at(-1)));
    assert.equal(getWinner(match.states.at(-1)), match.record.winner);
    assert.deepEqual(match.states.at(-1), match.record.finalState);
    assert.equal(match.states.length, match.record.moves.length + 1);
  }
});
test("chosen scenes replay unchanged prefixes, including whole pending capture chains", () => {
  const scenes = chooseScenes(matches);
  for (const scene of Object.values(scenes)) {
    const match = matches[scene.matchId];
    assert(scene.turn >= 20);
    assert.deepEqual(scene.moves, match.record.moves.slice(0, scene.turn));
    assert.deepEqual(scene.before, match.states[scene.turn]);
    assert.deepEqual(applyDecision(scene.before, scene.move), scene.after);
    if (scene.move.type === "jump")
      assert.deepEqual(applyDecision(scene.before, scene.move, false), scene.pending);
    const proof = provenance(match, scene.before, scene.turn);
    assert.equal(proof.boardSha256, boardHash(scene.before));
    assert.equal(proof.ledgerSha256, match.ledgerSha256);
  }
});
test("a changed decision, board fingerprint or engine source is rejected", () => {
  const match = matches.classic;
  const tampered = structuredClone(match.record);
  tampered.moves[0].position = { x: -1, y: -1 };
  assert.throws(() => validateMatch(tampered, match.record.engineSha256));
  const changedHash = structuredClone(match.record);
  changedHash.moves[5].boardSha256 = "invalid";
  assert.throws(() => validateMatch(changedHash, match.record.engineSha256));
  assert.throws(() => validateMatch(match.record, "another engine"));
});
