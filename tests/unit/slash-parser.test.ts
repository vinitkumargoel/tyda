import { describe, it, expect } from "vitest";

import { parseSlash } from "../../src/tui/slash/parser.js";

describe("parseSlash", () => {
  it("parses a simple slash command with one arg", () => {
    expect(parseSlash("/search biryani")).toEqual({
      cmd: "search",
      argv: ["biryani"],
    });
  });

  it("preserves a double-quoted string as a single argv token", () => {
    expect(
      parseSlash('/address add "Koramangala 4th Block, Bangalore"'),
    ).toEqual({
      cmd: "address",
      argv: ["add", "Koramangala 4th Block, Bangalore"],
    });
  });

  it("returns null when the line does not start with a slash", () => {
    expect(parseSlash("search biryani")).toBeNull();
  });

  it("treats a bare slash as an empty command with no argv", () => {
    expect(parseSlash("/")).toEqual({ cmd: "", argv: [] });
  });

  it("lowercases the command name", () => {
    expect(parseSlash("/MENU 1")).toEqual({ cmd: "menu", argv: ["1"] });
  });

  it("splits unquoted args on whitespace", () => {
    expect(parseSlash("/add M01 2")).toEqual({
      cmd: "add",
      argv: ["M01", "2"],
    });
  });

  it("supports multiple quoted args", () => {
    expect(parseSlash('/x "one two" "three four"')).toEqual({
      cmd: "x",
      argv: ["one two", "three four"],
    });
  });

  it("handles trailing whitespace gracefully", () => {
    expect(parseSlash("/help   ")).toEqual({ cmd: "help", argv: [] });
  });
});
