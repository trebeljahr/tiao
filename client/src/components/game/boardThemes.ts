/** Board theme definitions.
 *
 * Each theme provides a full set of visual tokens consumed by TiaoBoard,
 * InteractiveMiniBoard and the confetti system.
 *
 * All themes are "unlocked" for now — gating behind purchases can be added
 * later by checking an entitlement before allowing selection.
 */

// ---------------------------------------------------------------------------
// Theme shape
// ---------------------------------------------------------------------------

export type BoardTheme = {
  id: string;
  name: string;
  description: string;

  // Board surface
  boardBg: string;
  boardBorder: string;
  boardInnerBg: string;
  boardShadow: string;
  boardSheen: string; // radial-gradient overlay for surface sheen

  // Grid
  gridLineColor: string;
  grooveStart: string;
  grooveEnd: string;
  starPointColor: string;

  // Pieces
  blackPieceBorder: string;
  blackPieceBg: string;
  whitePieceBorder: string;
  whitePieceBg: string;
  pieceShadow: string;
  selectableGlow: string;

  // Jump trails — active (green = forward, red = undo)
  jumpTrailDarkGreen: string;
  jumpTrailBrightGreen: string;
  jumpTrailPreviewGreen: string;
  jumpTrailDarkRed: string;
  jumpTrailBrightRed: string;
  jumpArrowGreenFill: string;
  jumpArrowRedFill: string;

  // Last-move trail (blue)
  lastMoveDark: string;
  lastMoveBright: string;
  lastMoveArrowFill: string;
  lastMoveDotBg: string;

  // Selection / target highlights
  forcedOriginBorder: string;
  selectedBorder: string;
  jumpTargetBorder: string;
  jumpTargetBg: string;
  lastMoveBorder: string;

  // Confirm / Undo overlays
  confirmBorder: string;
  confirmBg: string;
  confirmText: string;
  confirmShadow: string;
  undoBorder: string;
  undoBg: string;
  undoText: string;
  undoShadow: string;

  // Confetti
  victoryColors: string[];
  defeatColors: string[];

  // Mobile crosshair
  crosshairColor: string;
};

// ---------------------------------------------------------------------------
// Classic  (the existing wooden board)
// ---------------------------------------------------------------------------

export const CLASSIC: BoardTheme = {
  id: "classic",
  name: "Classic",
  description: "Traditional wooden board",

  boardBg: "linear-gradient(180deg,rgba(234,199,131,0.98),rgba(217,177,104,0.98))",
  boardBorder: "#cdb07f",
  boardInnerBg: "linear-gradient(180deg,rgba(255,250,240,0.16),rgba(255,255,255,0.04))",
  boardShadow: "0 52px 120px -42px rgba(66,39,11,0.92)",
  boardSheen:
    "radial-gradient(circle at top left,rgba(255,248,234,0.28),transparent 28%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent 42%)",

  gridLineColor: "#6c4926",
  grooveStart: "#7a542d",
  grooveEnd: "#65421f",
  starPointColor: "#573615",

  blackPieceBorder: "#191410",
  blackPieceBg: "radial-gradient(circle at 30% 28%,#5d554f,#2d2622 58%,#0f0c0b)",
  whitePieceBorder: "#ddd2bf",
  whitePieceBg: "radial-gradient(circle at 30% 28%,#fffdfa,#f4eee3 58%,#d9ccb8)",
  pieceShadow: "inset 0 2px 10px rgba(255,255,255,0.18), 0 10px 18px rgba(0,0,0,0.18)",
  selectableGlow:
    "0 0 0 4px rgba(242,208,144,0.22), inset 0 2px 10px rgba(255,255,255,0.18), 0 10px 18px rgba(0,0,0,0.18)",

  jumpTrailDarkGreen: "#5f813d",
  jumpTrailBrightGreen: "#8dbc62",
  jumpTrailPreviewGreen: "#a6d476",
  jumpTrailDarkRed: "#9f5d57",
  jumpTrailBrightRed: "#d8928a",
  jumpArrowGreenFill: "#8dbc62",
  jumpArrowRedFill: "#c9837b",

  lastMoveDark: "#365f8a",
  lastMoveBright: "#4a8ac4",
  lastMoveArrowFill: "#4a8ac4",
  lastMoveDotBg: "#4a8ac4",

  forcedOriginBorder: "#8c6326",
  selectedBorder: "rgba(114,87,46,0.95)",
  jumpTargetBorder: "#73935f",
  jumpTargetBg: "rgba(243,250,238,0.78)",
  lastMoveBorder: "#4a8ac4",

  confirmBorder: "rgba(167,193,145,0.95)",
  confirmBg: "rgba(247,253,243,0.98)",
  confirmText: "#5e7b4e",
  confirmShadow: "0 14px 22px -14px rgba(66,89,47,0.62)",
  undoBorder: "#deaaaa",
  undoBg: "rgba(255,247,246,0.98)",
  undoText: "#ba6561",
  undoShadow: "0 12px 20px -14px rgba(134,70,67,0.55)",

  victoryColors: [
    "#ff6b6b",
    "#feca57",
    "#48dbfb",
    "#ff9ff3",
    "#54a0ff",
    "#5f27cd",
    "#01a3a4",
    "#f368e0",
    "#ff9f43",
    "#00d2d3",
  ],
  defeatColors: ["#8b7355", "#a69278", "#c4b49a", "#d6cbb8"],

  crosshairColor: "#6c4926",
};

// ---------------------------------------------------------------------------
// Night  (dark slate board with cool-toned pieces)
// ---------------------------------------------------------------------------

export const NIGHT: BoardTheme = {
  id: "night",
  name: "Night",
  description: "Dark slate board for low-light play",

  boardBg: "linear-gradient(180deg,#1e1e2a,#16161f)",
  boardBorder: "#2a2a3a",
  boardInnerBg: "linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))",
  boardShadow: "0 52px 120px -42px rgba(0,0,0,0.85)",
  boardSheen:
    "radial-gradient(circle at top left,rgba(100,120,180,0.10),transparent 28%),linear-gradient(135deg,rgba(255,255,255,0.02),transparent 42%)",

  gridLineColor: "#3d3d52",
  grooveStart: "#2e2e42",
  grooveEnd: "#252535",
  starPointColor: "#4a4a64",

  blackPieceBorder: "#2a2a40",
  blackPieceBg: "radial-gradient(circle at 30% 28%,#5a5a72,#3a3a52 58%,#22223a)",
  whitePieceBorder: "#b8b8d0",
  whitePieceBg: "radial-gradient(circle at 30% 28%,#e8e8f4,#c4c4d8 58%,#a0a0b8)",
  pieceShadow:
    "inset 0 2px 10px rgba(140,160,255,0.15), 0 0 0 1px rgba(100,110,160,0.18), 0 10px 18px rgba(0,0,0,0.35)",
  selectableGlow:
    "0 0 0 4px rgba(120,140,220,0.25), inset 0 2px 10px rgba(140,160,255,0.15), 0 0 0 1px rgba(100,110,160,0.18), 0 10px 18px rgba(0,0,0,0.35)",

  jumpTrailDarkGreen: "#3d6644",
  jumpTrailBrightGreen: "#6aad5e",
  jumpTrailPreviewGreen: "#82cc72",
  jumpTrailDarkRed: "#7a4040",
  jumpTrailBrightRed: "#c06868",
  jumpArrowGreenFill: "#6aad5e",
  jumpArrowRedFill: "#b85858",

  lastMoveDark: "#2e5080",
  lastMoveBright: "#4488cc",
  lastMoveArrowFill: "#4488cc",
  lastMoveDotBg: "#4488cc",

  forcedOriginBorder: "#6e6e90",
  selectedBorder: "rgba(120,120,170,0.90)",
  jumpTargetBorder: "#5a8a5a",
  jumpTargetBg: "rgba(40,60,40,0.65)",
  lastMoveBorder: "#4488cc",

  confirmBorder: "rgba(90,140,90,0.90)",
  confirmBg: "rgba(30,45,30,0.95)",
  confirmText: "#7cc47c",
  confirmShadow: "0 14px 22px -14px rgba(0,0,0,0.70)",
  undoBorder: "#8a4a4a",
  undoBg: "rgba(50,28,28,0.95)",
  undoText: "#d47070",
  undoShadow: "0 12px 20px -14px rgba(0,0,0,0.65)",

  victoryColors: [
    "#7c6aff",
    "#4ae0d4",
    "#ff6baa",
    "#5ce8ff",
    "#ffd75c",
    "#a07cff",
    "#00d4aa",
    "#ff8ccc",
    "#6caaff",
    "#e0ff6c",
  ],
  defeatColors: ["#3a3a52", "#4a4a64", "#5a5a76", "#6a6a88"],

  crosshairColor: "#5a5a76",
};

// ---------------------------------------------------------------------------
// Sakura  (cherry-blossom pink with soft warm tones)
// ---------------------------------------------------------------------------

export const SAKURA: BoardTheme = {
  id: "sakura",
  name: "Sakura",
  description: "Soft cherry-blossom pink",

  boardBg: "linear-gradient(180deg,rgba(245,218,220,0.98),rgba(232,196,198,0.98))",
  boardBorder: "#ddb8ba",
  boardInnerBg: "linear-gradient(180deg,rgba(255,245,245,0.18),rgba(255,255,255,0.05))",
  boardShadow: "0 52px 120px -42px rgba(120,50,55,0.55)",
  boardSheen:
    "radial-gradient(circle at top left,rgba(255,230,235,0.35),transparent 28%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent 42%)",

  gridLineColor: "#b8787c",
  grooveStart: "#c48a8e",
  grooveEnd: "#a87276",
  starPointColor: "#96585c",

  blackPieceBorder: "#2a1618",
  blackPieceBg: "radial-gradient(circle at 30% 28%,#5a3a3c,#3a1e20 58%,#1a0a0c)",
  whitePieceBorder: "#f0d8da",
  whitePieceBg: "radial-gradient(circle at 30% 28%,#fff4f5,#f4dce0 58%,#e8c4c8)",
  pieceShadow: "inset 0 2px 10px rgba(255,200,210,0.22), 0 10px 18px rgba(80,20,25,0.16)",
  selectableGlow:
    "0 0 0 4px rgba(240,160,170,0.28), inset 0 2px 10px rgba(255,200,210,0.22), 0 10px 18px rgba(80,20,25,0.16)",

  jumpTrailDarkGreen: "#6a7a4a",
  jumpTrailBrightGreen: "#92b062",
  jumpTrailPreviewGreen: "#aac87a",
  jumpTrailDarkRed: "#a05a5a",
  jumpTrailBrightRed: "#d48888",
  jumpArrowGreenFill: "#92b062",
  jumpArrowRedFill: "#c87878",

  lastMoveDark: "#6a5a8a",
  lastMoveBright: "#8a78b0",
  lastMoveArrowFill: "#8a78b0",
  lastMoveDotBg: "#8a78b0",

  forcedOriginBorder: "#a8727a",
  selectedBorder: "rgba(150,80,88,0.90)",
  jumpTargetBorder: "#7a9a68",
  jumpTargetBg: "rgba(245,252,240,0.78)",
  lastMoveBorder: "#8a78b0",

  confirmBorder: "rgba(150,190,140,0.90)",
  confirmBg: "rgba(248,254,244,0.98)",
  confirmText: "#5e7b4e",
  confirmShadow: "0 14px 22px -14px rgba(66,89,47,0.50)",
  undoBorder: "#d4a0a0",
  undoBg: "rgba(255,245,244,0.98)",
  undoText: "#b06060",
  undoShadow: "0 12px 20px -14px rgba(134,70,67,0.45)",

  victoryColors: [
    "#ff8fa0",
    "#ffb0c0",
    "#ffd4e0",
    "#ff6b8a",
    "#e0a0ff",
    "#ffaacc",
    "#ff70a0",
    "#ffc0d8",
    "#d090ff",
    "#ffddee",
  ],
  defeatColors: ["#9a7a7c", "#aa8a8c", "#ba9a9c", "#caaaac"],

  crosshairColor: "#b8787c",
};

// ---------------------------------------------------------------------------
// Ocean  (deep blue-green, nautical feel)
// ---------------------------------------------------------------------------

export const OCEAN: BoardTheme = {
  id: "ocean",
  name: "Ocean",
  description: "Deep blue-green sea board",

  boardBg: "linear-gradient(180deg,rgba(140,190,200,0.98),rgba(110,165,180,0.98))",
  boardBorder: "#8ab8c4",
  boardInnerBg: "linear-gradient(180deg,rgba(220,245,250,0.14),rgba(255,255,255,0.04))",
  boardShadow: "0 52px 120px -42px rgba(15,50,65,0.80)",
  boardSheen:
    "radial-gradient(circle at top left,rgba(220,248,255,0.28),transparent 28%),linear-gradient(135deg,rgba(255,255,255,0.07),transparent 42%)",

  gridLineColor: "#3a7080",
  grooveStart: "#4a8090",
  grooveEnd: "#356878",
  starPointColor: "#2a5a68",

  blackPieceBorder: "#0a1a20",
  blackPieceBg: "radial-gradient(circle at 30% 28%,#3a5560,#1a3038 58%,#081820)",
  whitePieceBorder: "#c8dce4",
  whitePieceBg: "radial-gradient(circle at 30% 28%,#f0f8fc,#d8eaf0 58%,#b8d4e0)",
  pieceShadow: "inset 0 2px 10px rgba(180,220,240,0.20), 0 10px 18px rgba(0,30,50,0.22)",
  selectableGlow:
    "0 0 0 4px rgba(120,200,220,0.25), inset 0 2px 10px rgba(180,220,240,0.20), 0 10px 18px rgba(0,30,50,0.22)",

  jumpTrailDarkGreen: "#3a7a5a",
  jumpTrailBrightGreen: "#5aaa7a",
  jumpTrailPreviewGreen: "#72c490",
  jumpTrailDarkRed: "#8a5050",
  jumpTrailBrightRed: "#c07070",
  jumpArrowGreenFill: "#5aaa7a",
  jumpArrowRedFill: "#b06060",

  lastMoveDark: "#3050a0",
  lastMoveBright: "#4870cc",
  lastMoveArrowFill: "#4870cc",
  lastMoveDotBg: "#4870cc",

  forcedOriginBorder: "#3a7a8a",
  selectedBorder: "rgba(50,100,120,0.90)",
  jumpTargetBorder: "#4a9070",
  jumpTargetBg: "rgba(230,250,242,0.75)",
  lastMoveBorder: "#4870cc",

  confirmBorder: "rgba(80,170,140,0.90)",
  confirmBg: "rgba(238,252,248,0.98)",
  confirmText: "#2a7a5a",
  confirmShadow: "0 14px 22px -14px rgba(20,60,50,0.55)",
  undoBorder: "#b08080",
  undoBg: "rgba(255,248,246,0.98)",
  undoText: "#a05050",
  undoShadow: "0 12px 20px -14px rgba(100,40,40,0.50)",

  victoryColors: [
    "#48dbfb",
    "#00d2d3",
    "#5ce8a0",
    "#4ae0d4",
    "#6cc4ff",
    "#2af0c0",
    "#70e0ff",
    "#3ad8b8",
    "#88ccff",
    "#00e8c8",
  ],
  defeatColors: ["#4a6a78", "#5a7a88", "#6a8a98", "#7a9aa8"],

  crosshairColor: "#3a7080",
};

// ---------------------------------------------------------------------------
// Marble  (cool grey stone with glass-like pieces)
// ---------------------------------------------------------------------------

export const MARBLE: BoardTheme = {
  id: "marble",
  name: "Marble",
  description: "Cool grey stone board",

  boardBg: "linear-gradient(180deg,rgba(215,215,220,0.98),rgba(195,195,202,0.98))",
  boardBorder: "#b8b8c0",
  boardInnerBg: "linear-gradient(180deg,rgba(245,245,250,0.16),rgba(255,255,255,0.06))",
  boardShadow: "0 52px 120px -42px rgba(30,30,40,0.70)",
  boardSheen:
    "radial-gradient(circle at top left,rgba(248,248,255,0.32),transparent 28%),linear-gradient(135deg,rgba(255,255,255,0.10),transparent 42%)",

  gridLineColor: "#7a7a88",
  grooveStart: "#8a8a96",
  grooveEnd: "#6e6e7c",
  starPointColor: "#5a5a68",

  blackPieceBorder: "#101014",
  blackPieceBg: "radial-gradient(circle at 30% 28%,#4a4a54,#282830 58%,#0e0e14)",
  whitePieceBorder: "#e0e0e8",
  whitePieceBg: "radial-gradient(circle at 30% 28%,#fafafc,#e8e8f0 58%,#d0d0dc)",
  pieceShadow: "inset 0 2px 10px rgba(255,255,255,0.22), 0 10px 18px rgba(0,0,0,0.20)",
  selectableGlow:
    "0 0 0 4px rgba(180,180,220,0.25), inset 0 2px 10px rgba(255,255,255,0.22), 0 10px 18px rgba(0,0,0,0.20)",

  jumpTrailDarkGreen: "#4a7a4a",
  jumpTrailBrightGreen: "#6aaa6a",
  jumpTrailPreviewGreen: "#82c482",
  jumpTrailDarkRed: "#8a4a4a",
  jumpTrailBrightRed: "#c06868",
  jumpArrowGreenFill: "#6aaa6a",
  jumpArrowRedFill: "#b05858",

  lastMoveDark: "#4a5a8a",
  lastMoveBright: "#6878b0",
  lastMoveArrowFill: "#6878b0",
  lastMoveDotBg: "#6878b0",

  forcedOriginBorder: "#7a7a8a",
  selectedBorder: "rgba(90,90,110,0.90)",
  jumpTargetBorder: "#5a8a5a",
  jumpTargetBg: "rgba(240,250,240,0.75)",
  lastMoveBorder: "#6878b0",

  confirmBorder: "rgba(120,170,120,0.90)",
  confirmBg: "rgba(245,252,245,0.98)",
  confirmText: "#4a7a4a",
  confirmShadow: "0 14px 22px -14px rgba(40,60,40,0.55)",
  undoBorder: "#b0a0a0",
  undoBg: "rgba(252,248,248,0.98)",
  undoText: "#8a5a5a",
  undoShadow: "0 12px 20px -14px rgba(80,40,40,0.50)",

  victoryColors: [
    "#b0b0ff",
    "#ff9090",
    "#90e0a0",
    "#f0d060",
    "#80d0f0",
    "#c8a0ff",
    "#ff80b0",
    "#60e0c0",
    "#e0b060",
    "#a0c0ff",
  ],
  defeatColors: ["#6a6a78", "#7a7a88", "#8a8a98", "#9a9aa8"],

  crosshairColor: "#7a7a88",
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const THEMES: BoardTheme[] = [CLASSIC, NIGHT, SAKURA, OCEAN, MARBLE];

export const THEME_MAP: Record<string, BoardTheme> = Object.fromEntries(
  THEMES.map((t) => [t.id, t]),
);

export const DEFAULT_THEME_ID = "classic";

export function getTheme(id: string): BoardTheme {
  return THEME_MAP[id] ?? CLASSIC;
}
