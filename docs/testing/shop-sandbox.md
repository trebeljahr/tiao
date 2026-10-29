# Local shop sandbox

Use this runner for no-money shop QA with a disposable database. Steam builds use
Steam Microtransactions; web and direct desktop builds use Stripe Checkout.

## Start

Prerequisites: Node 24+, installed repo dependencies, `mongod`, and Stripe CLI.
Build the current web client before running the stack:

```sh
pnpm --dir client build
node scripts/shop-sandbox.mjs --secrets-file /absolute/private/shop-qa.env
```

The explicit private env file may contain only the credentials needed here:

```dotenv
STRIPE_SECRET_KEY=sk_test_REPLACE
STEAM_PUBLISHER_WEB_API_KEY=REPLACE
```

Keep that file outside the repository with mode `0600`. The runner copies only
those two variables from it. It does not inherit the repository's dotenv files,
MongoDB/Redis connections, mail, OAuth, analytics, or other store credentials.
A Stripe key must start with `sk_test_` or `rk_test_` and pass a read-only preflight.
A Steam publisher key must cover app 5035580 and have Microtransactions permission.
Changing a key's permissions is a separate account operation requiring approval.

Options:

- `--web-export /path/to/client/out`: use an existing built web export.
- `--without-stripe`: explicitly disable Stripe; useful for Steam-only QA.
- `--without-web`: run API/database/listener only.

The console prints random high ports and the temporary state directory. Open the
printed shop URL. Create synthetic accounts with `example.invalid` addresses.
`NODE_ENV=test` disables mail and rate limiting while retaining the real API,
MongoDB persistence, authentication, payment clients, and fulfillment code.

Enter `r` to restart only the API against the same isolated database, or `q` to
stop all owned services. Ctrl-C also cleans up. Data and redacted logs remain in
the printed directory; `session.json` contains ports and owned PIDs, never keys.
Do not terminate an unrelated process to free a port.

## Payment boundaries

- Fresh `mongod`, bound to loopback, with its own dbpath and no production data.
- API and web listener bound to loopback on checked random ports.
- `STEAM_MICROTXN_SANDBOX=true`, app 5035580, and a runtime guard rejecting the
  live `/ISteamMicroTxn/` fetch interface. The production application separately
  refuses Steam sandbox configuration.
- Stripe CLI receives the same test key as the API, uses a private temporary CLI
  config, and forwards to this API's `/api/shop/webhook`. Its signing secret is
  captured in memory and supplied to that API, rather than copied from a dashboard.
- Keychain access is denied for current native test clients. The runner itself
  never reads OS credentials. Do not launch a direct desktop client without its
  credential-denial flag.

Before any purchase, check `/api/shop/iap/config` from the actual client. Steam
must report `enabled: true, sandbox: true`. For Stripe, retrieve the actual Checkout
Session with the test key and verify `livemode=false`; the hosted page also shows
Sandbox. Use only official test cards/payment methods.

## Packaged native clients and HTTPS

Release native clients can require HTTPS both in native code and renderer CSP.
An optional sidecar reuses an existing trusted certificate; it does not issue a
certificate, change DNS, install trust, or read the OS keychain:

```sh
node scripts/shop-sandbox-tls.mjs \
  --api-port PRINTED_API_PORT \
  --host YOUR_EXISTING_LOOPBACK_DNS_NAME \
  --cert /private/existing-certificate.pem \
  --key /private/existing-private-key.pem
```

Default binding is `127.0.0.1`; DNS must resolve only to that address, and the
certificate must cover the hostname and be unexpired. If an established dev domain
resolves to this Mac's private Tailscale address, `--bind-address THAT_ADDRESS`
is supported only after explicit permission for that temporary network exposure.
The script refuses public or nonlocal bind addresses. Stop the sidecar after QA.

For the existing Electron Steam local build, a separate process can use
`TIAO_API_URL` plus a fresh `--user-data-dir` and `--mute-audio`. Also pass
`--password-store=basic --use-mock-keychain`; verify that packaged Steam auth disables
persistence before using it. Keep the existing user's process alive. Use a checked
high loopback debugging port if attaching browser automation. Never open its
production shop as a fallback. Steam may route authorization into the original
running game's overlay; get explicit permission before capturing or using that
window, and confirm “My Steam Wallet (sandbox)” before authorizing.

## Flow checks

Record device/SDK, provider, build commit, order/session ID, observed provider
state, ledger state, and entitlement. Separate real sandbox results, human-assisted
approvals, signed replays, mocked tests, and API-only cross-client checks.

1. Buy a one-time badge/theme through actual Checkout or Steam shop UI.
2. Cancel/deny and confirm no entitlement. A Stripe back-link cancellation can
   leave the session open/unpaid; it does not imply a paid transaction.
3. Double click Buy, replay the real signed webhook, and repeat finalization/status.
   Confirm session/order counts and one entitlement, not merely HTTP 200.
4. Stop only the owned API after creating checkout but before approval. Complete
   the sandbox approval; confirm payment succeeded while the database is ungranted.
   Restart, reconcile, and verify the real UI after reload.
5. Check another account cannot claim the order, and a second authenticated client
   for the same account sees its entitlement.
6. For Patron, create a Stripe Billing test clock and customer, place that customer
   on a synthetic account in this isolated database, then call Tiao's actual
   subscription Checkout. Pay with a test card. Advance through the period boundary
   and invoice finalization window, verify paid renewal, replace the default payment
   method with `pm_card_chargeCustomerFail`, advance again, inspect `past_due`/grace,
   cancel through Tiao, and verify terminal expiry removes the badge.

Detailed dated QA evidence belongs in the Tiao project folder of `ai-work-notes`.
