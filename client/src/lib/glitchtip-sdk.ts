// Keep the lazy module's public surface narrow so webpack can remove Sentry's
// unused tracing, replay, profiling and integration exports.
export { captureException, init, setUser, withScope } from "@sentry/browser";
