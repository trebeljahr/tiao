# Steam accounts and existing web logins

Native Steam startup verifies a `tiao-auth` Web API ticket and calls
`ensureSteamAccount`. The first launch creates a Steam-only account with a valid,
unique username derived from the Steam profile. Later launches resolve the same
provider record. A browser can use Continue with Steam to access that account.

An automatic Steam account offers **Link existing account** in Settings. Password
or browser SSO proves the web identity, but does not replace the Steam session.
The Electron main process keeps this candidate token in memory and sends only its
display name to the renderer. The player confirms the destination before the main
process submits a fresh native ticket with the web session to `/api/auth/steam/session`.
Only successful linking replaces the app session. Closing the dialog cancels the
flow and revokes a staged desktop token.

## Data policy

The existing web identity is canonical. Its username, profile settings, login
methods and established Elo remain. Played-game counts, badges, themes,
achievements, friends, friend requests, game history and Steam purchase records
are combined. If the web account has no rated games, the Steam Elo carries over.
Duplicate achievements keep their earliest unlock date. Reports and moderation
flags follow the account; banned or privileged Steam identities cannot merge.

Only automatically created, Steam-only accounts can merge. A Steam identity that
already has another login, or a destination with another Steam identity, produces
a conflict. External billing credentials are not reassigned. Live games,
matchmaking, unfinished tournaments, pending purchases and running data exports
must finish first. Accounts that both participated in the same tournament require
manual handling; automatic linking refuses without moving their data.

## Recovery and browser completion

Steam operations serialize per verified SteamID, using Redis locks in deployment.
An interrupted data migration is bound to its original destination by
`steamAccountLinks`. The old identity is disabled and its sessions revoked before
data moves. Idempotent updates prevent duplicate game counts or entitlements on
retry. The Steam provider moves after the data; cleanup then removes the obsolete
identity and temporary migration records. Repeating the same verified link resumes
the migration. A later native Steam login can resume its already-confirmed,
durably bound destination and finish cleanup after provider reassignment.

Desktop browser SSO uses PKCE. A `tiao://` callback remains the fast path; a bounded
polling loop can retrieve the same single-use code with the app-held verifier.
Polling never exposes a bearer token or verifier in browser URLs. Completion
records expire after five minutes. Cancellation stops polling, and a late deep
link cannot complete an already-consumed flow again.

Focused coverage lives in `server/tests/integration/steamAccounts.test.ts`,
`server/tests/integration/steamOpenId.test.ts`, `desktop/src/authBridge.test.cjs`
and the client account-linking tests. Native Steam tickets and live provider login
windows still require an installed release for end-to-end platform verification.
