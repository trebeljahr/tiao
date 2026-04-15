import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Source-level guard against a sneaky regression.
 *
 * `DesktopOfflineLobby` renders four links to `/local`, `/computer`,
 * `/tutorial`, `/privacy`. On the web build those get locale-rewritten
 * by Next.js middleware, but the desktop static export has no
 * middleware — every locale-less href is served by the `app://tiao/`
 * protocol handler, which only knows about `<locale>/tutorial/` etc.
 * and 404s the rest (visible as `HEAD app://tiao/tutorial/ 404` noise
 * in the smoke-test console).
 *
 * The fix is to import `Link` from `@/i18n/navigation` (next-intl's
 * localized wrapper) instead of `next/link`. A render-based test
 * can't catch a revert because the vitest setup in
 * `src/test/setup.ts` mocks BOTH `@/i18n/navigation.Link` and
 * `next/link` to render as plain `<a>` — the two imports are
 * indistinguishable at render time. So we guard the import at the
 * source-text level instead.
 */
describe("DesktopOfflineLobby imports", () => {
  const sourcePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "./DesktopOfflineLobby.tsx",
  );
  const source = readFileSync(sourcePath, "utf-8");

  it("imports Link from @/i18n/navigation, not next/link", () => {
    // Positive assertion: the localized Link must be imported.
    expect(source).toMatch(/import\s*\{\s*Link\s*\}\s*from\s*["']@\/i18n\/navigation["']/);
  });

  it("does NOT import from next/link", () => {
    // Negative assertion: a raw `next/link` import re-breaks locale
    // prefixing. Stripping out comments first so the prose rationale
    // in the component header doesn't count as a match.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeOnly).not.toMatch(/from\s*["']next\/link["']/);
  });
});
