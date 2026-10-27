// @ts-check
const fs = require("node:fs");
const path = require("node:path");

/** @param {string} userDataPath */
function createWindowPreferences(userDataPath) {
  const file = path.join(userDataPath, "window-preferences.json");
  return {
    getFullScreen() {
      try {
        const preferences = JSON.parse(fs.readFileSync(file, "utf8"));
        return typeof preferences?.fullScreen === "boolean" ? preferences.fullScreen : true;
      } catch {
        return true;
      }
    },
    /** @param {boolean} enabled */
    setFullScreen(enabled) {
      try {
        fs.mkdirSync(userDataPath, { recursive: true });
        fs.writeFileSync(`${file}.tmp`, JSON.stringify({ fullScreen: enabled }), { mode: 0o600 });
        fs.renameSync(`${file}.tmp`, file);
      } catch (error) {
        console.error("Could not save fullscreen preference", error);
      }
    },
  };
}

module.exports = { createWindowPreferences };
