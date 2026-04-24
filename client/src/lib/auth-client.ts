/**
 * Lazy-loaded better-auth client singleton.
 *
 * `better-auth/react` + `better-auth/client/plugins` together weigh
 * 3.4 MB in node_modules. The old eager `import { createAuthClient }`
 * at module-top pulled the entire graph into every route's cold compile
 * via AuthContext → providers.tsx → [locale]/layout.tsx.
 *
 * Now the client is constructed on first `getAuthClient()` call via a
 * dynamic `import()`. The promise is cached so subsequent calls resolve
 * immediately. Every caller already runs inside an async function
 * (login, signup, signOut, linkSocial, etc.), so the extra `await` is
 * invisible.
 *
 * Unlike glitchtip/openpanel, better-auth IS needed in dev (users log
 * in during development), so there is no NODE_ENV gate. The win is
 * purely structural: the initial cold compile of any route skips the
 * 3.4 MB graph, and the first auth operation pays the one-time lazy
 * load cost (~50–100 ms on a warm FS).
 */
import { API_BASE_URL } from "./api";

async function loadClient() {
  const [{ createAuthClient }, { anonymousClient }] = await Promise.all([
    import("better-auth/react"),
    import("better-auth/client/plugins"),
  ]);
  return createAuthClient({
    baseURL: API_BASE_URL,
    basePath: "/api/auth",
    plugins: [anonymousClient()],
  });
}

let clientPromise: ReturnType<typeof loadClient> | null = null;

/**
 * Returns the better-auth client singleton. First call triggers the
 * dynamic import; subsequent calls return the cached promise.
 */
export function getAuthClient() {
  // biome-ignore lint/suspicious/noAssignInExpressions: lazy-init singleton via ??=
  return (clientPromise ??= loadClient());
}
