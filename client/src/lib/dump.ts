export {};

type LogEntry = {
  timestamp: string;
  level: "log" | "warn" | "error" | "info" | "debug";
  message: string;
};

const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];

function captureLog(level: LogEntry["level"], args: unknown[]) {
  const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");

  logBuffer.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });

  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.splice(0, logBuffer.length - LOG_BUFFER_SIZE);
  }
}

const originalConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  info: console.info.bind(console),
  debug: console.debug.bind(console),
};

console.log = (...args: unknown[]) => {
  captureLog("log", args);
  originalConsole.log(...args);
};
console.warn = (...args: unknown[]) => {
  captureLog("warn", args);
  originalConsole.warn(...args);
};
console.error = (...args: unknown[]) => {
  captureLog("error", args);
  originalConsole.error(...args);
};
console.info = (...args: unknown[]) => {
  captureLog("info", args);
  originalConsole.info(...args);
};
console.debug = (...args: unknown[]) => {
  captureLog("debug", args);
  originalConsole.debug(...args);
};

window.addEventListener("error", (event) => {
  captureLog("error", [
    `Uncaught: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
  ]);
});

window.addEventListener("unhandledrejection", (event) => {
  captureLog("error", [`Unhandled rejection: ${event.reason}`]);
});

function dump() {
  const data = {
    version: process.env.APP_VERSION,
    userAgent: navigator.userAgent,
    url: window.location.href,
    timestamp: new Date().toISOString(),
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      devicePixelRatio: window.devicePixelRatio,
    },
    logs: logBuffer.slice(),
  };

  const json = JSON.stringify(data, null, 2);
  originalConsole.log(json);
  return data;
}

declare global {
  interface Window {
    Dump: typeof dump;
  }
}

window.Dump = dump;
