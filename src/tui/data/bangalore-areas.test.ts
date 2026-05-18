import { describe, it, expect } from "vitest";

import { BANGALORE_AREAS, findArea } from "./bangalore-areas.js";

describe("BANGALORE_AREAS", () => {
  it("has at least 12 entries", () => {
    expect(BANGALORE_AREAS.length).toBeGreaterThanOrEqual(12);
  });

  it("every entry has a slug, name, pincode, and finite lat/lng", () => {
    for (const a of BANGALORE_AREAS) {
      expect(a.slug).toMatch(/^[a-z0-9-]+$/);
      expect(a.name.length).toBeGreaterThan(0);
      expect(a.pincode).toMatch(/^\d{6}$/);
      expect(Number.isFinite(a.lat)).toBe(true);
      expect(Number.isFinite(a.lng)).toBe(true);
      // Sanity: should be in/around Bangalore.
      expect(a.lat).toBeGreaterThan(12.5);
      expect(a.lat).toBeLessThan(13.5);
      expect(a.lng).toBeGreaterThan(77.3);
      expect(a.lng).toBeLessThan(78.0);
    }
  });

  it("slugs are unique", () => {
    const slugs = BANGALORE_AREAS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("findArea", () => {
  it("matches by slug", () => {
    expect(findArea("koramangala")?.pincode).toBe("560034");
  });

  it("matches by full name", () => {
    expect(findArea("HSR Layout")?.slug).toBe("hsr");
  });

  it("matches by first word of name (case-insensitive)", () => {
    expect(findArea("indiranagar")?.pincode).toBe("560038");
    expect(findArea("WHITEFIELD")?.slug).toBe("whitefield");
  });

  it("returns undefined for unknown areas", () => {
    expect(findArea("Atlantis")).toBeUndefined();
    expect(findArea("")).toBeUndefined();
  });
});
