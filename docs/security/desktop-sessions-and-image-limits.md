# Desktop authentication and upload limits

## Session contract

Desktop bearer tokens use `v2` HMAC signatures plus records in MongoDB's
`desktopSessions` collection. Every authentication checks the record, its current
nonce and expiry, the originating Better Auth session, and a fingerprint of the
account's credential hashes, linked identities, verified email, and privileges.
Deleting the game account or auth user, banning the auth user, changing that
security state, or revoking/expiring the originating web session denies access.
Profile edits and OAuth access-token refreshes do not revoke desktop access.
Storage failures deny authentication.

Tokens last at most 30 days. Refresh atomically replaces the current nonce and
caps the session family at 90 days from issuance. The originating web session
must also remain valid: desktop refresh does not prolong that web session. A
copied old token cannot refresh after rotation. Logout deletes the family, even
when presented with an older, correctly signed token from that family. MongoDB
records, not a local process cache, determine validity across server instances.
OAuth exchange codes bind both the originating session and the security state
observed at callback time.

HTTP requests revalidate on authentication. Desktop WebSocket messages revalidate
before game/lobby actions; 10-second heartbeat checks also close idle revoked connections.
Already-running requests and outgoing events before the next heartbeat are not
retroactively cancelled. A refresh invalidates the prior WebSocket credential;
clients using `/refresh` must retain the replacement token and reconnect sockets.

The desktop logout IPC waits for server acknowledgement before deleting local
credentials. If offline or revocation fails, logout reports an error and retains
the credential so the user can retry. It does not claim successful remote logout.

## Deployment and migration (not performed by local changes)

1. Coordinate the server and desktop releases. Existing desktop releases clear
   credentials locally and do not call `/api/auth/desktop/logout`.
2. All server instances must use this implementation before relying on revocation.
   Mixed old/new instances leave old stateless-token validation available. Do not
   roll back to the old verifier after promising users that logout revokes tokens.
3. Existing `v1` tokens and exchange codes from the old deployment are not accepted
   or silently upgraded. Users must complete OAuth again. No signing-key rotation
   is required. Deploying this policy intentionally ends legacy desktop access;
   approve and communicate that migration before rollout. Web cookies are unchanged.
4. Grant the application its normal MongoDB access to `desktopSessions`. `_id` is
   the session-family key and uses MongoDB's built-in unique index. Create a TTL
   index on `purgeAt` with `expireAfterSeconds: 0` as deployment maintenance. TTL
   deletion is only cleanup; code enforces expiry even without that index. If no
   TTL index is provisioned, expired records remain until explicitly cleaned up.
5. Verify real MongoDB date/ID handling, multi-instance rotation/logout, password
   reset/change, provider unlinking, account deletion, web session revocation, and
   WebSocket closure in staging with disposable users. Check database query cost
   before rollout; every bearer authentication performs uncached security reads.
6. Verify packaged Electron and configured development OAuth/navigation flows,
   including offline logout retries, callback handling, and token replacement.

## Electron trust boundary

Only explicitly registered app windows' current main frames can call privileged
IPC. Bundled windows require exactly `app://tiao` with no credentials or port.
Unpackaged development windows may use only their configured HTTP(S) origin,
including its exact port. A packaged build cannot select an HTTP renderer.
Navigation and redirects cannot cross that trust boundary. Child-frame
navigation and webview attachment are denied. New windows are always denied;
trusted app links load in the existing window, while HTTP, HTTPS, and mailto links
may open externally. Other external schemes are rejected. OAuth still launches
in the system browser and returns through the separate `tiao:` callback handler.

These controls address missing defenses identified by source review; they do not
establish that a remote exploit occurred, or eliminate XSS within the trusted app.

## Profile images

Authentication occurs before multipart parsing. Multipart is bounded to one file,
no fields, one part, and 512 KiB. Byte-based structural inspection runs before
Jimp: each side is at most 2048 pixels, area at most 4,000,000 pixels, one frame,
and JPEG has at most 32 scans. Supported uploads are JPEG, non-interlaced PNG, and
single-frame GIF. Animated images and interlaced PNG are rejected. The installed
Jimp has no WebP decoder; the former WebP MIME claim is removed from the server
and file pickers. Unsupported formats receive 415 rather than entering a decoder.

PNG interlace is rejected because the installed pngjs implementation uses an
unbounded inflate path for interlaced data. Its non-interlaced path bounds inflate
output from checked dimensions. JPEG also receives decoder-level 4 MP and 64 MiB
allocation budgets. Full decode/resize/encode runs in at most two worker threads
per server process, with no waiting queue, a five-second deadline, and V8 heap
limits. Worker environments and inherited runtime hooks are cleared. V8 limits
are not an operating-system cap on native buffer memory; dimension/decoder
budgets remain essential. Output fits within 320 × 320, including tall images.
Saturation returns 503. Worker termination is awaited before releasing a slot.

No decompression bombs, malicious images, load tests, live credentials, or live
user records are required to validate the ordinary regression cases.
