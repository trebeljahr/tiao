import { join } from "node:path";
import { Worker } from "node:worker_threads";

/**
 * The 1200×630 link-preview card for game, profile and tournament links,
 * rendered to JPEG: the gradients make a ~390 KB PNG, and WhatsApp drops
 * preview images over about 300 KB. The web client is static files, so the game server draws
 * the per-link images that Next's `opengraph-image` routes drew before; the
 * layout is the same as client/src/lib/tiaoOgImage.tsx.
 *
 * Rendering (layout, rasterising, JPEG encoding) is CPU work, so it runs in
 * a worker thread: the event loop keeps serving games. The worker stays up
 * for five idle minutes, so a burst of crawlers pays its start-up once.
 *
 * Fonts: Geist (SIL Open Font License 1.1, assets/fonts/OFL.txt), read
 * relative to the working directory, which is server/ in development and
 * /app/server in the image.
 */

export const PREVIEW_SIZE = { width: 1200, height: 630 };

export type PreviewCard = {
  eyebrow: string;
  title: string;
  subtitle: string;
  meta: string[];
};

type Style = Record<string, string | number>;
type Node = { type: string; props: { style?: Style; children?: Child | Child[] } };
type Child = Node | string;

function h(type: string, style: Style, ...children: Child[]): Node {
  // satori counts an empty children array as several children.
  if (!children.length) return { type, props: { style } };
  return { type, props: { style, children: children.length === 1 ? children[0] : children } };
}

const STONES = [
  { x: 5, y: 4, color: "#f8f1e6" },
  { x: 6, y: 4, color: "#1f1711" },
  { x: 7, y: 5, color: "#f8f1e6" },
  { x: 8, y: 6, color: "#1f1711" },
  { x: 4, y: 7, color: "#1f1711" },
  { x: 5, y: 8, color: "#f8f1e6" },
  { x: 9, y: 8, color: "#1f1711" },
  { x: 10, y: 9, color: "#f8f1e6" },
];

function boardPreview(): Node {
  const lines = Array.from({ length: 13 }, (_, index) => index);
  const line = (style: Style) =>
    h("div", { position: "absolute", background: "rgba(60, 36, 18, 0.42)", ...style });
  // No box-shadows: resvg draws each blurred shadow as a Gaussian filter,
  // which made a render take seconds. A flat offset shape stands in for
  // the board's shadow.
  const board = h(
    "div",
    {
      display: "flex",
      position: "absolute",
      top: 0,
      left: 0,
      width: 384,
      height: 384,
      borderRadius: 28,
      background: "linear-gradient(135deg, #e7c98d 0%, #bc8650 100%)",
      border: "3px solid rgba(61, 37, 19, 0.5)",
    },
    ...lines.map((i) => line({ left: 34, right: 34, top: 36 + i * 26, height: 2 })),
    ...lines.map((i) => line({ top: 36, bottom: 36, left: 36 + i * 26, width: 2 })),
    ...STONES.map((stone) =>
      h("div", {
        position: "absolute",
        left: 36 + stone.x * 26 - 13,
        top: 36 + stone.y * 26 - 13,
        width: 30,
        height: 30,
        borderRadius: 999,
        background: stone.color,
        border: stone.color === "#1f1711" ? "2px solid #0d0906" : "2px solid #fff9ef",
      }),
    ),
  );
  return h(
    "div",
    { display: "flex", position: "relative", width: 384, height: 404 },
    h("div", {
      position: "absolute",
      top: 20,
      left: 6,
      width: 372,
      height: 384,
      borderRadius: 28,
      background: "rgba(47, 27, 12, 0.22)",
    }),
    board,
  );
}

export function previewTree({ eyebrow, title, subtitle, meta }: PreviewCard): Node {
  const left = h(
    "div",
    { display: "flex", flexDirection: "column", width: 650 },
    h(
      "div",
      {
        display: "flex",
        alignItems: "center",
        gap: 14,
        marginBottom: 48,
        fontSize: 30,
        fontWeight: 900,
      },
      h("div", {
        width: 42,
        height: 42,
        borderRadius: 999,
        background: "#24170e",
      }),
      h("span", {}, "Tiao"),
    ),
    h(
      "div",
      {
        display: "flex",
        alignSelf: "flex-start",
        padding: "8px 14px",
        borderRadius: 999,
        background: "rgba(36, 23, 14, 0.09)",
        color: "#5f3b20",
        fontSize: 22,
        fontWeight: 700,
        marginBottom: 18,
      },
      eyebrow,
    ),
    h(
      "div",
      {
        display: "flex",
        fontSize: title.length > 38 ? 58 : 68,
        lineHeight: 1,
        fontWeight: 900,
        marginBottom: 24,
      },
      title,
    ),
    h(
      "div",
      { display: "flex", fontSize: 30, lineHeight: 1.25, color: "#54361f", maxWidth: 610 },
      subtitle,
    ),
    h(
      "div",
      { display: "flex", gap: 12, marginTop: "auto", flexWrap: "wrap" },
      ...meta.slice(0, 3).map((item) =>
        h(
          "div",
          {
            display: "flex",
            padding: "10px 16px",
            borderRadius: 999,
            background: "rgba(255, 255, 255, 0.56)",
            color: "#382312",
            fontSize: 22,
            fontWeight: 700,
          },
          item,
        ),
      ),
    ),
  );
  return h(
    "div",
    {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "stretch",
      justifyContent: "space-between",
      padding: 54,
      background: "linear-gradient(135deg, #fff8ea 0%, #ecd2a4 48%, #9f6639 100%)",
      color: "#24170e",
      fontFamily: "Geist",
    },
    left,
    h(
      "div",
      { display: "flex", alignItems: "center", justifyContent: "center", flex: 1 },
      boardPreview(),
    ),
  );
}

// A fixed program. It gets the resolved library paths and the font
// directory once, then one card's element tree per message; environment and
// runtime hooks are cleared. Cards render one after another.
const RENDER_WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const satori = require(workerData.satori).default;
const { Resvg } = require(workerData.resvg);
const { Jimp } = require(workerData.jimp);
const fonts = workerData.fonts.map(([file, weight]) => ({
  name: 'Geist', data: readFileSync(join(workerData.fontDir, file)), weight, style: 'normal'
}));
let queue = Promise.resolve();
parentPort.on('message', ({ id, tree }) => {
  queue = queue.then(async () => {
    try {
      const svg = await satori(tree, { width: workerData.width, height: workerData.height, fonts });
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: workerData.width } }).render().asPng();
      const image = await Jimp.read(png);
      parentPort.postMessage({ id, image: await image.getBuffer('image/jpeg', { quality: workerData.quality }) });
    } catch {
      parentPort.postMessage({ id, error: true });
    }
  });
});
`;

const FONTS = [
  ["Geist-Regular.ttf", 400],
  ["Geist-Bold.ttf", 700],
  ["Geist-Black.ttf", 900],
];
/** Cards waiting at most; more answer 503 (the edge retries are cheap). */
const MAX_PENDING = 4;
const RENDER_TIMEOUT_MS = 15_000;
/** The warm worker saves its start-up (~1 s on the server) per render. */
const IDLE_MS = 5 * 60_000;

export class PreviewBusyError extends Error {}

type Pending = { resolve: (image: Buffer) => void; reject: (error: Error) => void };
type RenderWorker = { worker: Worker; pending: Map<number, Pending>; idle?: NodeJS.Timeout };

let current: RenderWorker | null = null;
let nextId = 0;

function renderWorker(): RenderWorker {
  if (current) return current;
  const worker = new Worker(RENDER_WORKER, {
    eval: true,
    env: {},
    execArgv: [],
    workerData: {
      ...PREVIEW_SIZE,
      quality: 86,
      fonts: FONTS,
      fontDir: join(process.cwd(), "assets", "fonts"),
      satori: require.resolve("satori"),
      resvg: require.resolve("@resvg/resvg-js"),
      jimp: require.resolve("jimp"),
    },
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
  });
  const state: RenderWorker = { worker, pending: new Map() };
  const stop = () => {
    if (current === state) current = null;
    for (const { reject } of state.pending.values()) reject(new Error("Preview worker stopped."));
    state.pending.clear();
  };
  worker.on("message", ({ id, image }: { id: number; image?: Uint8Array }) => {
    const job = state.pending.get(id);
    if (!job) return;
    state.pending.delete(id);
    if (image instanceof Uint8Array) job.resolve(Buffer.from(image));
    else job.reject(new Error("Preview rendering failed."));
  });
  worker.on("error", stop);
  worker.on("exit", stop);
  // After the listeners: a 'message' listener refs the worker's port again.
  worker.unref();
  current = state;
  return state;
}

export async function renderPreviewImage(card: PreviewCard): Promise<Buffer> {
  const state = renderWorker();
  if (state.pending.size >= MAX_PENDING) throw new PreviewBusyError("Preview rendering is busy.");
  clearTimeout(state.idle);
  const id = nextId++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(id);
        reject(new Error("Preview rendering timed out."));
      }, RENDER_TIMEOUT_MS);
      state.pending.set(id, {
        resolve: (image) => {
          clearTimeout(timer);
          resolve(image);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      state.worker.postMessage({ id, tree: previewTree(card) });
    });
  } finally {
    if (!state.pending.size && current === state) {
      state.idle = setTimeout(() => void state.worker.terminate(), IDLE_MS);
      state.idle.unref();
    }
  }
}
