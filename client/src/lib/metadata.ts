// Page-level `openGraph` declarations replace (not deep-merge) the layout's,
// so every page that overrides `openGraph` must re-declare `images` or the
// share image goes missing for that URL.
export const OG_IMAGES = [
  { url: "/tiao-thumbnail.png", width: 1200, height: 630, alt: "Tiao board game" },
];
