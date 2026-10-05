import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./index-redirect.js", import.meta.url), "utf8");

function redirect(pathname, language = "en-US") {
  let target = null;
  const location = { pathname, replace: (url) => (target = url) };
  vm.runInNewContext(source, { location, navigator: { language } });
  return target;
}

test("root shell sends the user to a real locale home page", () => {
  assert.equal(redirect("/"), "/en/");
  assert.equal(redirect("/index.html", "de-DE"), "/de/");
  assert.equal(redirect("/", "fr-FR"), "/en/");
  assert.equal(redirect("/es/no-such-page/"), "/es/");
  assert.equal(redirect("/no-such-page/", "es"), "/es/");
});
