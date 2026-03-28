# Investigation: Authentication Strategy

**Status:** Decided — see [ADR #4 (Session Strategy: HMAC Cookie Digests)](../ARCHITECTURE_DECISIONS.md#4-session-strategy-hmac-cookie-digests) and [ADR #8 (Dual Authentication: Guest + Account)](../ARCHITECTURE_DECISIONS.md#8-dual-authentication-guest--account)
**Date:** 2026-03-25

## Context

The game needed authentication supporting both instant play (no signup wall) and persistent accounts with social features. The original implementation used JWT tokens. External auth libraries like better-auth, Passport, Lucia, Clerk, and Auth0 were considered as alternatives to a custom solution.

## Options Considered

### JWT Tokens (original implementation)

- Stateless — no server-side session storage needed
- Cannot be revoked without a blacklist (which requires storage, defeating the purpose)
- Larger payload (header + payload + signature)
- Overkill for single-backend architecture — no cross-service token validation needed

### Third-Party Auth Libraries (better-auth, Passport, Lucia, Auth0, Clerk)

- Reduce boilerplate and provide battle-tested auth flows
- Add significant dependency weight and abstraction layers
- Many are designed for OAuth/social login flows — the game only needs email/password + guest
- Auth0/Clerk are hosted services with recurring costs
- Passport is middleware-heavy and adds complexity for simple session management
- better-auth and Lucia are lighter but still add abstraction over what is a straightforward requirement

### Custom HMAC Cookie Sessions (chosen)

- HttpOnly cookies with random 48-byte base64url tokens
- Server stores only HMAC-SHA256 digest in MongoDB with TTL index
- Immediate session revocation (just delete from DB)
- Simple, auditable, minimal dependencies
- SameSite=Strict + HttpOnly + Secure flags handle XSS/CSRF

## Outcome

Custom HMAC cookie sessions were chosen. The auth model splits into two player types sharing a common `PlayerIdentity` shape:

- **Guest:** Instant creation, no credentials, ephemeral, limited features
- **Account:** Email/password (bcrypt), persistent profile, friends, history

The reasoning: with a single Express backend, MongoDB already available, and only email/password auth needed, a third-party library adds complexity without meaningful benefit. The session store is ~250 lines of straightforward code. JWT was removed in commit `c38a245b`.
