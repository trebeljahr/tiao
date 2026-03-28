# Investigation: Internationalization (i18n)

**Status:** Decided — next-intl, infrastructure in place, translations deferred until demand
**Date:** 2026-03-28

## Context

All UI strings in the client are hardcoded inline across ~100 components (~500+ translatable strings). The app currently serves English only (`lang="en"` in layout.tsx). As the game grows, supporting additional languages could expand the player base — but i18n is a significant retrofit with real tradeoffs for a project of this size and niche.

### How Lichess Does It

Lichess supports **140+ languages** using Crowdin (a community translation platform) with volunteer translators. Their approach:

- **Routing:** Language-specific subdomains (`en.lichess.org`, `ru.lichess.org`) rather than URL prefixes
- **Translation management:** Crowdin web interface — no technical skills needed to contribute
- **Approval:** Voting system, not single-approver gatekeeping
- **Build integration:** `i18n-file-gen` npm script generates translation files from Crowdin at build time
- **Game terminology:** Variant names (Bullet, Blitz, Chess960) are treated as proper nouns and left untranslated
- **Known pain points:** Incomplete string coverage (ongoing dev work to expose new strings), pluralization mismatches (Russian needs 4 forms, Crowdin supports 3), language detection conflicts between browser/cookie/account/URL preferences

Lichess's scale (millions of users, 140+ languages) justifies the investment. For Tiao, the question is whether the overhead makes sense at current scale.

## Is It Worth It?

**Arguments for:**

- 9 of the top 10 app markets by downloads are non-English
- Games see engagement boosts when localized — players prefer native language UI
- Retrofitting later is 2-3x more expensive than building i18n-ready infrastructure now
- Setting up the plumbing now (even with only English) makes future translation trivial

**Arguments against:**

- Tiao is a niche abstract strategy game — the audience skews toward English-speaking board game enthusiasts
- Estimated effort: **120-175 hours** (3-4 weeks) for full retrofit
- Ongoing maintenance cost: every new feature needs strings extracted and translated
- Translation quality for game-specific terminology requires domain expertise, not just language fluency
- No current user demand signal for other languages

**Honest assessment:** The ROI is marginal right now. The strongest argument is setting up the infrastructure early so it's cheap to add languages later, rather than doing a painful retrofit when demand materializes. A phased approach (plumbing now, translations later) is the pragmatic middle ground.

## Biggest Challenges

1. **String extraction (~50% of effort)** — Manually extracting 500+ hardcoded strings from JSX is the largest time sink. Strings lose context when extracted (e.g., "Play" could mean "make a move" or "start a game"), so each needs a meaningful key and translator-facing description.

2. **App Router restructuring (~20%)** — Every route moves from `/game/[gameId]` to `/[locale]/game/[gameId]`. The entire `app/` directory gets nested under `[locale]/`. Dynamic routes like `[gameId]` and `[username]` must coexist with `[locale]` without conflicts.

3. **Custom server integration (~15%)** — The custom `server.mjs` handles WebSocket upgrades and HTTP proxying. Middleware for locale detection must not interfere with `/ws/*` or `/api/*` paths. API rewrites must remain locale-agnostic.

4. **Server vs. Client component split (~10%)** — Next.js App Router requires careful thinking about where translations load. Server components use `getTranslations()`, client components need `NextIntlClientProvider` wrappers. Getting this wrong causes hydration mismatches.

5. **Game-specific terminology (~5%)** — Terms like "ko", "liberty", "territory", "komi" may need to stay untranslated or need expert translators. Text expansion varies by language (German ~30% longer, CJK may be shorter), affecting compact game UI layouts.

## Options Considered

### next-intl

- Purpose-built for Next.js App Router with first-class support for URL prefix routing (`/en/`, `/pt/`)
- Built-in middleware for locale detection and redirect
- ICU message format (handles plurals, gender, number formatting correctly)
- Type-safe message keys with TypeScript
- Works with both Server and Client Components
- Smaller bundle than react-i18next
- Actively maintained, strong Next.js community adoption
- Less ecosystem/plugin variety than i18next

### react-i18next

- Most popular React i18n library (~9M weekly npm downloads vs ~500K for next-intl)
- Massive ecosystem: plugins for extraction, ICU, formatting, backends
- Framework-agnostic — works with any React setup
- **Not designed for App Router** — requires significant manual wiring for URL prefix routing, middleware, and server components
- Larger bundle size
- More boilerplate to achieve what next-intl does out of the box with App Router
- i18next-scanner can auto-extract strings from code (useful for the retrofit)

### Comparison

| Concern                   | next-intl                    | react-i18next                     |
| ------------------------- | ---------------------------- | --------------------------------- |
| App Router integration    | Native, first-class          | Manual, bolted-on                 |
| URL prefix routing        | Built-in middleware          | DIY middleware                    |
| Server Components         | Built-in `getTranslations()` | Requires custom setup             |
| Bundle size               | ~12KB                        | ~25KB+                            |
| Ecosystem size            | Smaller, focused             | Massive, general-purpose          |
| String extraction tools   | Manual or third-party        | i18next-scanner, cli-instrument   |
| Type safety               | Built-in                     | Via i18next-resources-to-ts       |
| Learning curve            | Lower for Next.js devs       | Lower if you know i18next already |
| SEO (hreflang, canonical) | Automatic                    | Manual                            |

## Recommendation: next-intl

**next-intl is the better fit** for this project because:

1. **The project uses Next.js App Router** — next-intl is designed specifically for this. react-i18next requires fighting the framework to achieve the same result.
2. **URL prefix routing is the chosen strategy** — next-intl's middleware handles `/[locale]/` routing, locale detection, and redirects out of the box.
3. **Custom server compatibility** — next-intl's middleware runs inside Next.js (before the custom server routes), so it won't interfere with WebSocket upgrades or API proxying.
4. **SEO** — Game pages and player profiles benefit from proper hreflang tags and locale-specific URLs. next-intl provides this automatically.
5. **Smaller surface area** — Less code to maintain, fewer moving parts.

The main downside vs react-i18next is the smaller ecosystem — but for this project's needs (message formatting, plurals, URL routing), next-intl covers everything without needing plugins.

## Decision

**Use next-intl when the time comes, but defer implementation until there's clear demand.** The ROI doesn't justify the 120-175 hour retrofit at current scale — Tiao is a niche abstract strategy game with no active user requests for other languages. When non-English players start showing up (or if the game expands to markets where localization is expected), revisit the phased approach above. The investigation and library choice are locked in so there's no re-evaluation cost when that happens.

## Suggested Phased Approach

### Phase 1: Infrastructure (8-12 hours)

- Install next-intl, create middleware.ts, restructure `app/` under `[locale]/`
- Configure locale detection (browser → cookie → default `en`)
- Set up message files structure (`messages/en.json`)
- Ensure `/api/*` and `/ws/*` paths bypass locale middleware
- Verify custom server.mjs still works

### Phase 2: Extract strings incrementally (ongoing)

- Don't extract all 500+ strings at once — do it page by page as you touch components
- Start with high-traffic pages: lobby, game, profile
- Use namespace separation (`game.json`, `lobby.json`, `profile.json`)

### Phase 3: Add languages (when demand exists)

- Set up Crowdin or similar translation platform
- Start with 1-2 languages (e.g., Portuguese, Spanish)
- Recruit community translators or use professional services for game terminology

## Verification

- After Phase 1: navigate to `/en/` and `/pt/` (or any configured locale) and confirm routing works, WebSocket connections still establish, API calls succeed
- Check that `<html lang="...">` reflects the active locale
- Confirm middleware redirects `/game/abc` → `/en/game/abc` (or detected locale)
- Run existing e2e tests to catch regressions in routing
