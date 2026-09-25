//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Controls imports
import { assignBinding, DEFAULT_CONTROLS } from "../../src/input/controls.ts";

//* Menu imports
import {
  createHomeState,
  listRomFiles,
  MenuKeyParser,
  parseRomArg,
  reduceMenu,
  renderMenu,
  type MenuState,
} from "../../src/menu/menu.ts";

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
      const state: MenuState = {
        screen: "render",
        cursor: 0,
        format: "braille",
        controls: DEFAULT_CONTROLS,
      };

      expect(reduceMenu(state, "confirm")).toEqual({
        type: "continue",
        state: { screen: "home", cursor: 0, format: "ansi", controls: DEFAULT_CONTROLS },
      });
    });

    it("opens the rom list sorted when Rom is confirmed", () => {
      const moved = reduceMenu(createHomeState("braille"), "down");
      if (moved.type !== "continue") {
        throw new Error("expected the cursor to move to Controls");
      }
      const step = reduceMenu(moved.state, "down");
      if (step.type !== "continue") {
        throw new Error("expected the cursor to move to Rom");
      }

      expect(reduceMenu(step.state, "confirm", ["b.gbc", "notes.txt", "a.gb"])).toEqual({
        type: "continue",
        state: {
          screen: "rom",
          cursor: 0,
          format: "braille",
          controls: DEFAULT_CONTROLS,
          roms: ["a.gb", "b.gbc"],
        },
      });
    });

    it("returns start with the selected rom path", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 1,
        format: "green",
        controls: DEFAULT_CONTROLS,
        roms: ["alpha.gb", "beta.gbc"],
      };

      expect(reduceMenu(state, "confirm")).toEqual({
        type: "start",
        format: "green",
        controls: DEFAULT_CONTROLS,
        romPath: "roms/beta.gbc",
      });
    });

    it("stays on the rom screen when the rom list is empty", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 0,
        format: "braille",
        controls: DEFAULT_CONTROLS,
        roms: [],
      };

      expect(reduceMenu(state, "confirm")).toEqual({ type: "continue", state });
    });
  });

  describe("back", () => {
    it("keeps the previous format when leaving the render screen", () => {
      const state: MenuState = {
        screen: "render",
        cursor: 2,
        format: "braille",
        controls: DEFAULT_CONTROLS,
      };

      expect(reduceMenu(state, "back")).toEqual({
        type: "continue",
        state: { screen: "home", cursor: 0, format: "braille", controls: DEFAULT_CONTROLS },
      });
    });

    it("returns to home on Rom and keeps the format", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 0,
        format: "blocks",
        controls: DEFAULT_CONTROLS,
        roms: ["game.gb"],
      };

      expect(reduceMenu(state, "back")).toEqual({
        type: "continue",
        state: { screen: "home", cursor: 2, format: "blocks", controls: DEFAULT_CONTROLS },
      });
    });

    it("quits from the home screen", () => {
      expect(reduceMenu(createHomeState("braille"), "back")).toEqual({ type: "quit" });
    });
  });

  describe("cursor movement", () => {
    const roms = ["a.gb", "b.gb", "c.gbc"];

    it("wraps from the first row to the last row", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 0,
        format: "braille",
        controls: DEFAULT_CONTROLS,
        roms,
      };

      expect(reduceMenu(state, "up")).toEqual({
        type: "continue",
        state: { screen: "rom", cursor: 2, format: "braille", controls: DEFAULT_CONTROLS, roms },
      });
    });

    it("wraps from the last row to the first row", () => {
      const state: MenuState = {
        screen: "rom",
        cursor: 2,
        format: "braille",
        controls: DEFAULT_CONTROLS,
        roms,
      };

      expect(reduceMenu(state, "down")).toEqual({
        type: "continue",
        state: { screen: "rom", cursor: 0, format: "braille", controls: DEFAULT_CONTROLS, roms },
      });
    });
  });
});

describe("renderMenu", () => {
  it("shows the selected format beside Render", () => {
    expect(renderMenu(createHomeState("braille"))).toBe(
      "\x1b[38;2;155;188;15m> RENDER  braille\x1b[0m\n  CONTROLS\n  ROM\n\nenter  open    esc  quit",
    );
  });

  it("shows an empty rom directory message", () => {
    const state: MenuState = {
      screen: "rom",
      cursor: 0,
      format: "braille",
      controls: DEFAULT_CONTROLS,
      roms: [],
    };

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

    it("maps a letter to a binding while capturing", () => {
      const parser = new MenuKeyParser();
      parser.setMode("capture");

      expect(parser.feed("W")).toEqual([
        { type: "binding", binding: { kind: "char", value: "w" } },
      ]);
    });

    it("maps an arrow to a binding while capturing", () => {
      const parser = new MenuKeyParser();
      parser.setMode("capture");

      expect(parser.feed("\x1b[A")).toEqual([
        { type: "binding", binding: { kind: "arrow", direction: "up" } },
      ]);
    });

    it("maps q to reserved while capturing", () => {
      const parser = new MenuKeyParser();
      parser.setMode("capture");

      expect(parser.feed("q")).toEqual([{ type: "reserved" }]);
    });

    it("maps a split escape sequence to up", () => {
    const parser = new MenuKeyParser();

    expect(parser.feed("\x1b")).toEqual([]);
    expect(parser.feed("[A")).toEqual(["up"]);
    parser.stop();
  });
});

describe("controls screen", () => {
  const home = createHomeState("braille");

  function openControls(): MenuState {
    const step = reduceMenu(home, "down");
    if (step.type !== "continue") {
      throw new Error("expected the controls row");
    }
    const opened = reduceMenu(step.state, "confirm");
    if (opened.type !== "continue") {
      throw new Error("expected the controls screen");
    }
    return opened.state;
  }

  it("opens the controls list from home", () => {
    expect(openControls().screen).toBe("controls");
  });

  it("captures a key and returns to the controls list", () => {
    const controls = openControls();
    const capture = reduceMenu(controls, "confirm");
    if (capture.type !== "continue" || capture.state.screen !== "capture") {
      throw new Error("expected capture");
    }

    const assigned = reduceMenu(capture.state, {
      type: "binding",
      binding: { kind: "char", value: "w" },
    });

    expect(assigned).toEqual({
      type: "continue",
      state: {
        screen: "controls",
        cursor: 0,
        format: "braille",
        controls: assignBinding(DEFAULT_CONTROLS, "a", { kind: "char", value: "w" }),
      },
    });
  });

  it("cancels capture without changing the binding", () => {
    const controls = openControls();
    const capture = reduceMenu(controls, "confirm");
    if (capture.type !== "continue") {
      throw new Error("expected capture");
    }

    expect(reduceMenu(capture.state, "back")).toEqual({
      type: "continue",
      state: controls,
    });
  });

  it("keeps the capture screen when q is reserved", () => {
    const controls = openControls();
    const capture = reduceMenu(controls, "confirm");
    if (capture.type !== "continue" || capture.state.screen !== "capture") {
      throw new Error("expected capture");
    }

    expect(reduceMenu(capture.state, { type: "reserved" })).toEqual({
      type: "continue",
      state: { ...capture.state, notice: "q is reserved" },
    });
  });

  it("moves a key off the button that already owns it", () => {
    const controls = openControls();
    const downToB = reduceMenu(controls, "down");
    if (downToB.type !== "continue") {
      throw new Error("expected B");
    }
    const capture = reduceMenu(downToB.state, "confirm");
    if (capture.type !== "continue" || capture.state.screen !== "capture") {
      throw new Error("expected capture");
    }

    const assigned = reduceMenu(capture.state, {
      type: "binding",
      binding: { kind: "char", value: "z" },
    });
    if (assigned.type !== "continue" || assigned.state.screen !== "controls") {
      throw new Error("expected controls");
    }

    expect(assigned.state.controls.b).toEqual([{ kind: "char", value: "z" }]);
    expect(assigned.state.controls.a).toEqual([{ kind: "char", value: "a" }]);
  });

  it("restores the default layout from reset", () => {
    const rebound = assignBinding(DEFAULT_CONTROLS, "a", { kind: "char", value: "w" });
    const state: MenuState = {
      screen: "controls",
      cursor: 8,
      format: "braille",
      controls: rebound,
    };

    expect(reduceMenu(state, "confirm")).toEqual({
      type: "continue",
      state: { ...state, controls: DEFAULT_CONTROLS },
    });
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
