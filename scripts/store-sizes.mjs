// Store screenshot sizes shared by store-screenshots.mjs and
// store-ui-screenshots.mjs. Pick one with `--size=<name>`; the default keeps
// the 1920×1080 Steam / press set in its original folder.
//
// Pixel sizes follow App Store Connect's screenshot specifications
// (developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications,
// checked 2026-10-08) and the ASC API display types in `ascType`. The CSS
// viewport is the pixel size divided by the device scale factor.
export const storeSizes = {
  "steam-1080p": { width: 1920, height: 1080, scale: 1 },
  // 6.9" iPhone (16/17/18 Pro Max). The largest iPhone set; ASC scales it down.
  "iphone-69": { width: 1320, height: 2868, scale: 3, ascType: "APP_IPHONE_67" },
  // 6.5" iPhone, required when no 6.9" set exists. Uploaded for older listings.
  "iphone-65": { width: 1284, height: 2778, scale: 3, ascType: "APP_IPHONE_65" },
  // iPhone Duo, outer and inner display (ASC display type APP_IPHONE_DUO).
  "iphone-duo-outer": { width: 1398, height: 2034, scale: 3, ascType: "APP_IPHONE_DUO" },
  "iphone-duo-inner": { width: 2007, height: 2853, scale: 3, ascType: "APP_IPHONE_DUO" },
  // 13" iPad, required because the iOS app runs on iPad (TARGETED_DEVICE_FAMILY 1,2).
  "ipad-13": { width: 2064, height: 2752, scale: 2, ascType: "APP_IPAD_PRO_3GEN_129" },
  // Mac App Store, 16:10.
  mac: { width: 2880, height: 1800, scale: 2, ascType: "APP_DESKTOP" },
};

export function storeSize(argv = process.argv) {
  const flag = argv.find((arg) => arg.startsWith("--size="));
  const name = flag ? flag.slice("--size=".length) : "steam-1080p";
  const size = storeSizes[name];
  if (!size) throw new Error(`Unknown --size=${name}; pick one of ${Object.keys(storeSizes)}`);
  const viewport = { width: size.width / size.scale, height: size.height / size.scale };
  // Store uploads reject alpha channels; JPEG never has one.
  const store = name !== "steam-1080p";
  return { name, ...size, viewport, store, ext: store ? "jpg" : "png" };
}
