/**
 * Thin structured-logging wrapper around `console` + the existing
 * GlitchTip/Sentry setup.
 *
 * Why not a real logging library? Two reasons:
 *
 * 1. We already ship errors to GlitchTip via `captureException` — introducing
 *    Pino/Winston/etc. would create two places to configure error pipelines.
 * 2. The main value of structured logging here is (a) consistent
 *    `[component]` prefixes so you can grep one subsystem out of the
 *    interleaved server log, and (b) routing real errors through
 *    `captureException` automatically so nobody has to remember.
 *
 * Usage:
 *
 *   const log = createLogger("ws");
 *   log.info("incoming connection", { path, gameId });
 *   log.warn("rejected disallowed origin", { origin });
 *   log.error("gameService.connect failed", err, { gameId });
 *
 * The `error` method ships `err` to GlitchTip automatically (no-op in dev)
 * with the component name + any extra `context` attached to the Sentry
 * scope. `info` / `warn` / `debug` are console-only — we don't want
 * transient info logs flooding the error dashboard.
 *
 * This file deliberately has zero runtime dependencies beyond `./glitchtip`
 * so it can be imported from any other module, including early-boot code,
 * without introducing circular imports.
 */

import { captureException } from "./glitchtip";

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(component: string): Logger {
  const prefix = `[${component}]`;

  return {
    info(message, context) {
      if (context && Object.keys(context).length > 0) {
        console.info(prefix, message, context);
      } else {
        console.info(prefix, message);
      }
    },

    warn(message, context) {
      if (context && Object.keys(context).length > 0) {
        console.warn(prefix, message, context);
      } else {
        console.warn(prefix, message);
      }
    },

    error(message, error, context) {
      if (error !== undefined) {
        console.error(prefix, message, error, context ?? "");
      } else {
        console.error(prefix, message, context ?? "");
      }
      if (error !== undefined) {
        try {
          captureException(error, { component, ...(context ?? {}) });
        } catch {
          /* swallow — logging must not itself throw */
        }
      }
    },

    debug(message, context) {
      // Gated to DEBUG=1 (or DEBUG=<component>) so we can enable per-subsystem
      // verbose logging without drowning in output.
      const debugEnv = process.env.DEBUG;
      if (!debugEnv) return;
      if (debugEnv !== "1" && debugEnv !== "true" && !debugEnv.includes(component)) return;
      if (context && Object.keys(context).length > 0) {
        console.debug(prefix, message, context);
      } else {
        console.debug(prefix, message);
      }
    },
  };
}
