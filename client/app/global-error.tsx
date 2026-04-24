"use client";

import { captureException } from "@/lib/glitchtip";
import { useEffect } from "react";

/**
 * Root-level error boundary. Catches errors in the root layout itself.
 * Must provide its own <html>/<body> since the root layout has failed.
 * Uses inline styles because the CSS pipeline may be broken.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "2rem",
          textAlign: "center",
          backgroundColor: "#faf6ee",
          color: "#2b1e14",
        }}
      >
        <h1 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#6e5b48", marginBottom: "1.5rem" }}>
          The application encountered an unexpected error.
        </p>
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "0.5rem 1.5rem",
              border: "1px solid #dcc7a2",
              borderRadius: "0.75rem",
              background: "white",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            style={{
              padding: "0.5rem 1.5rem",
              border: "none",
              borderRadius: "0.75rem",
              background: "#2b1e14",
              color: "white",
              cursor: "pointer",
            }}
          >
            Back to Lobby
          </button>
        </div>
      </body>
    </html>
  );
}
