// Shared between the server-rendered press route (which checks the zip on
// disk) and the client-rendered PressPage view. Kept out of the "use client"
// module on purpose: exports of a client module reach server components as
// client references, not plain values.
export const PRESS_EMAIL = "press@playtiao.com";
export const PRESS_KIT_ZIP_PATH = "press/tiao-press-kit.zip";
