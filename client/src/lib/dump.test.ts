import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { captureLog, logBuffer, LOG_BUFFER_SIZE, dump, installDump, originalConsole } from "./dump";

describe("dump", () => {
  beforeEach(() => {
    // Clear the log buffer between tests
    logBuffer.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("captureLog", () => {
    it("pushes entries into the log buffer", () => {
      captureLog("log", ["hello", "world"]);
      expect(logBuffer).toHaveLength(1);
      expect(logBuffer[0].level).toBe("log");
      expect(logBuffer[0].message).toBe("hello world");
      expect(logBuffer[0].timestamp).toBeTruthy();
    });

    it("stringifies non-string arguments", () => {
      captureLog("warn", [{ foo: 1 }, 42]);
      expect(logBuffer[0].message).toBe('{"foo":1} 42');
    });

    it("trims buffer to LOG_BUFFER_SIZE", () => {
      for (let i = 0; i < LOG_BUFFER_SIZE + 50; i++) {
        captureLog("log", [`msg-${i}`]);
      }
      expect(logBuffer).toHaveLength(LOG_BUFFER_SIZE);
      // oldest entries should have been removed
      expect(logBuffer[0].message).toBe("msg-50");
    });
  });

  describe("dump()", () => {
    it("returns an object with version, userAgent, url, screen, and logs", () => {
      vi.spyOn(originalConsole, "log").mockImplementation(() => {});
      captureLog("error", ["test error"]);
      const result = dump();

      expect(result).toHaveProperty("version");
      expect(result).toHaveProperty("userAgent");
      expect(result).toHaveProperty("url");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("screen");
      expect(result.screen).toHaveProperty("width");
      expect(result.screen).toHaveProperty("height");
      expect(result.screen).toHaveProperty("devicePixelRatio");
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0].message).toBe("test error");
    });

    it("returns a snapshot of logs (not a reference)", () => {
      vi.spyOn(originalConsole, "log").mockImplementation(() => {});
      captureLog("info", ["before"]);
      const result = dump();
      captureLog("info", ["after"]);
      // The returned logs should not include the entry added after dump()
      expect(result.logs).toHaveLength(1);
    });
  });

  describe("installDump", () => {
    it("attaches Dump to window", () => {
      // installDump is called at module load, but verify explicitly
      installDump();
      expect(window.Dump).toBe(dump);
    });

    it("intercepts console.log to capture entries", () => {
      vi.spyOn(originalConsole, "log").mockImplementation(() => {});
      installDump();
      const before = logBuffer.length;
      console.log("intercepted-test-message");
      expect(logBuffer.length).toBeGreaterThan(before);
      const last = logBuffer[logBuffer.length - 1];
      expect(last.message).toContain("intercepted-test-message");
      expect(last.level).toBe("log");
    });
  });
});
