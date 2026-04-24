import type { MultiplayerGameSummary } from "@shared";
import { describe, expect, it } from "vitest";
import { formatPlayerColor, getSummaryStatusLabel, translatePlayerColor } from "./GameShared";

describe("formatPlayerColor", () => {
  it("capitalises 'white' to 'White'", () => {
    expect(formatPlayerColor("white")).toBe("White");
  });

  it("capitalises 'black' to 'Black'", () => {
    expect(formatPlayerColor("black")).toBe("Black");
  });

  it("returns null for null input", () => {
    expect(formatPlayerColor(null)).toBeNull();
  });
});

describe("translatePlayerColor", () => {
  it("returns translated white color name", () => {
    const t = (key: string) => (key === "white" ? "Weiß" : key === "black" ? "Schwarz" : key);
    expect(translatePlayerColor("white", t)).toBe("Weiß");
  });

  it("returns translated black color name", () => {
    const t = (key: string) => (key === "white" ? "Blancas" : key === "black" ? "Negras" : key);
    expect(translatePlayerColor("black", t)).toBe("Negras");
  });

  it("returns English color names when using English translations", () => {
    const t = (key: string) => (key === "white" ? "White" : key === "black" ? "Black" : key);
    expect(translatePlayerColor("white", t)).toBe("White");
    expect(translatePlayerColor("black", t)).toBe("Black");
  });

  it("returns null for null input", () => {
    const t = (key: string) => key;
    expect(translatePlayerColor(null, t)).toBeNull();
  });
});

describe("getSummaryStatusLabel", () => {
  const baseSummary = {
    gameId: "test-1",
    roomType: "private",
    status: "finished",
    winner: "white",
    yourSeat: null,
    currentTurn: "white",
    historyLength: 10,
    players: [],
    seats: { white: null, black: null },
    score: { white: 10, black: 5 },
    createdAt: "",
    updatedAt: "",
    boardSize: 19,
    scoreToWin: 10,
    timeControl: null,
    clockMs: null,
    finishReason: null,
    rematch: null,
  } as unknown as MultiplayerGameSummary;

  it("uses formatPlayerColor (English) when no translation function is provided", () => {
    const result = getSummaryStatusLabel(baseSummary);
    expect(result).toBe("White won");
  });

  it("uses translatePlayerColor when a translation function is provided", () => {
    // biome-ignore lint/suspicious/noExplicitAny: explicit any acknowledged
    const t = (key: string, values?: any) => {
      if (key === "white") return "Weiß";
      if (key === "black") return "Schwarz";
      if (key === "colorWon") return `${values?.color} hat gewonnen`;
      return key;
    };
    const result = getSummaryStatusLabel(baseSummary, t);
    expect(result).toBe("Weiß hat gewonnen");
  });

  it("translates black winner correctly in Spanish", () => {
    const summary = { ...baseSummary, winner: "black" as const };
    // biome-ignore lint/suspicious/noExplicitAny: explicit any acknowledged
    const t = (key: string, values?: any) => {
      if (key === "white") return "Blancas";
      if (key === "black") return "Negras";
      if (key === "colorWon") return `${values?.color} ganó`;
      return key;
    };
    const result = getSummaryStatusLabel(summary, t);
    expect(result).toBe("Negras ganó");
  });
});
