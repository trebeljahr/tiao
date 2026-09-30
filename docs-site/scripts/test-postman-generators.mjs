import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

// Resolve through the actual plugin so this checks the installed patch in CI.
const require = createRequire(import.meta.url);
const pluginRequire = createRequire(require.resolve("docusaurus-plugin-openapi-docs"));
const postmanRequire = createRequire(pluginRequire.resolve("postman-collection"));
const generators = postmanRequire("./lib/superstring/dynamic-variables");
const { VariableScope } = pluginRequire("postman-collection");

test("all Postman dynamic examples work with patched Faker", () => {
  assert.ok(Object.keys(generators).length > 100);
  const scope = new VariableScope();
  for (const [name, { generator }] of Object.entries(generators)) {
    assert.equal(typeof generator, "function", name);
    const value = generator();
    assert.notEqual(value, undefined, name);
    assert.notEqual(value, null, name);
    assert.ok(String(value).length > 0, name);
    assert.notEqual(scope.replaceIn(`{{${name}}}`), `{{${name}}}`, name);
  }
});

test("custom compatibility examples retain their documented formats", () => {
  const generate = (name) => generators[name].generator();
  assert.match(generate("$randomPhoneNumber"), /^\d{3}-\d{3}-\d{4}$/);
  assert.match(generate("$randomPhoneNumberExt"), /^\d{1,2}-\d{3}-\d{3}-\d{4}$/);
  assert.match(generate("$randomCreditCardMask"), /^\*{3}\d{4}$/);
  assert.match(generate("$randomBankAccount"), /^\d{8}$/);
  assert.match(generate("$randomHexColor"), /^#[0-9a-f]{6}$/i);
  for (const category of [
    "Abstract",
    "Animals",
    "Business",
    "Cats",
    "City",
    "Food",
    "Nightlife",
    "Fashion",
    "People",
    "Nature",
    "Sports",
    "Transport",
  ]) {
    assert.equal(new URL(generate(`$random${category}Image`)).protocol, "https:");
  }
});
