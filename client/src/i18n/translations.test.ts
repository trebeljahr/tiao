import { describe, it, expect } from "vitest";
import en from "../../messages/en.json";
import de from "../../messages/de.json";
import es from "../../messages/es.json";

/**
 * Recursively collect all leaf keys from a nested object.
 * Returns keys in dot notation, e.g. "profile.setPassword".
 */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

const enKeys = new Set(collectKeys(en));
const deKeys = new Set(collectKeys(de));
const esKeys = new Set(collectKeys(es));

describe("translation completeness", () => {
  it("de.json has all keys from en.json", () => {
    const missing = [...enKeys].filter((k) => !deKeys.has(k));
    expect(missing, `Missing keys in de.json:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("es.json has all keys from en.json", () => {
    const missing = [...enKeys].filter((k) => !esKeys.has(k));
    expect(missing, `Missing keys in es.json:\n  ${missing.join("\n  ")}`).toEqual([]);
  });

  it("de.json has no orphaned keys missing from en.json", () => {
    const orphaned = [...deKeys].filter((k) => !enKeys.has(k));
    expect(orphaned, `Orphaned keys in de.json:\n  ${orphaned.join("\n  ")}`).toEqual([]);
  });

  it("es.json has no orphaned keys missing from en.json", () => {
    const orphaned = [...esKeys].filter((k) => !enKeys.has(k));
    expect(orphaned, `Orphaned keys in es.json:\n  ${orphaned.join("\n  ")}`).toEqual([]);
  });
});
