//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Controls imports
import {
  assignBinding,
  buildControlLookup,
  cloneControls,
  DEFAULT_CONTROLS,
  formatBindings,
  parseControls,
} from "./controls.ts";

describe("parseControls", () => {
  it("returns the default layout when the value is missing", () => {
    expect(parseControls(undefined)).toEqual(DEFAULT_CONTROLS);
  });

  it("keeps an empty list as an unbound button", () => {
    const controls = parseControls({ ...DEFAULT_CONTROLS, a: [] });

    expect(controls.a).toEqual([]);
    expect(controls.b).toEqual(DEFAULT_CONTROLS.b);
  });

  it("drops a reserved key and a duplicate binding", () => {
    const controls = parseControls({
      a: [{ kind: "char", value: "q" }, { kind: "char", value: "Z" }],
      b: [{ kind: "char", value: "z" }],
    });

    expect(controls.a).toEqual([{ kind: "char", value: "z" }]);
    expect(controls.b).toEqual([]);
  });
});

describe("assignBinding", () => {
  it("replaces the button list and removes the key from the other button", () => {
    const next = assignBinding(DEFAULT_CONTROLS, "up", { kind: "char", value: "w" });

    expect(next.up).toEqual([{ kind: "char", value: "w" }]);
    expect(next.a).toEqual(DEFAULT_CONTROLS.a);
    expect(DEFAULT_CONTROLS.up).toEqual([{ kind: "arrow", direction: "up" }]);
  });

  it("moves a key that already belongs to another button", () => {
    const next = assignBinding(DEFAULT_CONTROLS, "b", { kind: "char", value: "z" });

    expect(next.b).toEqual([{ kind: "char", value: "z" }]);
    expect(next.a).toEqual([{ kind: "char", value: "a" }]);
  });

  it("leaves controls unchanged when the key is reserved", () => {
    const next = assignBinding(DEFAULT_CONTROLS, "a", { kind: "char", value: "q" });

    expect(next).toEqual(DEFAULT_CONTROLS);
  });
});

describe("formatBindings", () => {
  it("joins labels and marks an empty list as unbound", () => {
    expect(formatBindings(DEFAULT_CONTROLS.a)).toBe("z, a");
    expect(formatBindings(DEFAULT_CONTROLS.select)).toBe("space");
    expect(formatBindings(DEFAULT_CONTROLS.up)).toBe("up");
    expect(formatBindings([])).toBe("unbound");
  });
});

describe("buildControlLookup", () => {
  it("maps a letter to both cases in legacy and kitty forms", () => {
    const lookup = buildControlLookup(cloneControls(DEFAULT_CONTROLS));

    expect(lookup.legacy.get("z")).toBe("a");
    expect(lookup.legacy.get("Z")).toBe("a");
    expect(lookup.codepoint.get(122)).toBe("a");
    expect(lookup.codepoint.get(90)).toBe("a");
    expect(lookup.legacy.get(" ")).toBe("select");
    expect(lookup.codepoint.get(13)).toBe("start");
    expect(lookup.legacy.get("\n")).toBe("start");
    expect(lookup.arrow.get("A")).toBe("up");
  });
});
