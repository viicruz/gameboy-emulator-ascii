//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Menu imports
import {
  createHomeState,
  listRomFiles,
  MenuKeyParser,
  parseRomArg,
  reduceMenu,
  renderMenu,
  type MenuState,
} from "./menu.ts";

describe("reduceMenu", () => {
  describe("confirm", () => {
    it("opens the format list with the cursor on the current format", () => {
      const step = reduceMenu(createHomeState("braille"), "confirm");
      if (step.type !== "continue") {
        throw new Error("expected the format list");
      }

      expect(renderMenu(step.state).split("\n")).toContain("\x1b[38;2;155;188;15m> braille\x1b[0m");
    });

    it("returns home with the chosen format and the cursor on Render", () => {
      const state: MenuState = { screen: "render", cursor: 0, format: "braille" };

      expect(reduceMenu(state, "confirm")).toEqual({
        type: "continue",
        state: { screen: "home", cursor: 0, format: "ansi" },
      });
    });

    it("opens the rom list sorted when Rom is confirmed", () => {
      const step = reduceMenu(createHomeState("braille"), "down");
      if (step.type !== "continue") {
        throw new Error("expected the cursor to move to Rom");
      }

      expect(reduceMenu(step.state, "confirm", ["b.gbc", "notes.txt", "a.gb"])).toEqual({
        type: "continue",
        state: {
          screen: "rom",
          cursor: 0,
          format: "braille",
          roms: ["a.gb", "b.gbc"],
        },
      });
    });

    it("returns start with the selected rom path", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 1,
        format: "green",
        roms: ["alpha.gb", "beta.gbc"],
      };

      expect(reduceMenu(state, "confirm")).toEqual({
        type: "start",
        format: "green",
        romPath: "roms/beta.gbc",
      });
    });

    it("stays on the rom screen when the rom list is empty", () => {
      const state: MenuState = { screen: "rom", cursor: 0, format: "braille", roms: [] };

      expect(reduceMenu(state, "confirm")).toEqual({ type: "continue", state });
    });
  });

  describe("back", () => {
    it("keeps the previous format when leaving the render screen", () => {
      const state: MenuState = { screen: "render", cursor: 2, format: "braille" };

      expect(reduceMenu(state, "back")).toEqual({
        type: "continue",
        state: { screen: "home", cursor: 0, format: "braille" },
      });
    });

    it("returns to home on Rom and keeps the format", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 0,
        format: "blocks",
        roms: ["game.gb"],
      };

      expect(reduceMenu(state, "back")).toEqual({
        type: "continue",
        state: { screen: "home", cursor: 1, format: "blocks" },
      });
    });

    it("quits from the home screen", () => {
      expect(reduceMenu(createHomeState("braille"), "back")).toEqual({ type: "quit" });
    });
  });

  describe("cursor movement", () => {
    const roms = ["a.gb", "b.gb", "c.gbc"];

    it("wraps from the first row to the last row", () => {
      const state: MenuState = { screen: "rom", cursor: 0, format: "braille", roms };

      expect(reduceMenu(state, "up")).toEqual({
        type: "continue",
        state: { screen: "rom", cursor: 2, format: "braille", roms },
      });
    });

    it("wraps from the last row to the first row", () => {
      const state: MenuState = { screen: "rom", cursor: 2, format: "braille", roms };

      expect(reduceMenu(state, "down")).toEqual({
        type: "continue",
        state: { screen: "rom", cursor: 0, format: "braille", roms },
      });
    });
  });
});

describe("renderMenu", () => {
  it("shows the selected format beside Render", () => {
    expect(renderMenu(createHomeState("braille"))).toBe(
      "\x1b[38;2;155;188;15m> RENDER  braille\x1b[0m\n  ROM\n\nenter  open    esc  quit",
    );
  });

  it("shows an empty rom directory message", () => {
    const state: MenuState = { screen: "rom", cursor: 0, format: "braille", roms: [] };

    expect(renderMenu(state)).toBe("ROM\n\nno roms in roms/\n\nesc  back");
  });
});

describe("MenuKeyParser", () => {
  it("maps an up arrow to up", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\x1b[A")).toEqual(["up"]);
  });

  it("maps an SS3 down arrow to down", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\x1bOB")).toEqual(["down"]);
  });

  it("maps enter to confirm", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\r")).toEqual(["confirm"]);
    expect(parser.feed("\n")).toEqual(["confirm"]);
  });

  it("maps Ctrl+C to quit", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\x03")).toEqual(["quit"]);
  });

  it("maps a lone escape to back when flushed", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\x1b")).toEqual([]);
    expect(parser.flush()).toEqual(["back"]);
  });

  it("maps a split escape sequence to up", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\x1b")).toEqual([]);
    expect(parser.feed("[A")).toEqual(["up"]);
    parser.stop();
  });
});

describe("listRomFiles", () => {
  it("keeps gb and gbc names, drops other names, and sorts", () => {
    expect(listRomFiles(["zeta.gbc", "notes.txt", "alpha.gb", "nested/skip.gb", "Demo.GB"])).toEqual([
      "alpha.gb",
      "Demo.GB",
      "zeta.gbc",
    ]);
  });
});

describe("parseRomArg", () => {
  it("returns undefined when the rom flag is absent", () => {
    expect(parseRomArg(["--format", "braille"])).toBeUndefined();
  });

  it("reads a space-separated rom path", () => {
    expect(parseRomArg(["--rom", "roms/game.gb"])).toBe("roms/game.gb");
  });

  it("reads an inline rom path", () => {
    expect(parseRomArg(["--rom=roms/game.gbc"])).toBe("roms/game.gbc");
  });

  it("throws when the rom flag has no value", () => {
    expect(() => parseRomArg(["--rom"])).toThrow("Missing value for --rom.");
  });
});
