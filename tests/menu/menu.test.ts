//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Controls imports
import { assignBinding, DEFAULT_CONTROLS } from "../../src/input/controls.ts";

//* Menu imports
import {
  createHomeState,
  directoryToRead,
  listRomFiles,
  MenuKeyParser,
  parseRomArg,
  reduceMenu,
  renderMenu,
  type MenuSession,
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
        ...createHomeState("braille"),
        screen: "render",
        cursor: 0,
      };

      expect(reduceMenu(state, "confirm")).toEqual({
        type: "continue",
        state: createHomeState("braille"),
      });
    });

    it("opens the rom list sorted when Rom is confirmed", () => {
      let state = createHomeState("braille");
      for (const label of ["Controls", "Library", "Rom"]) {
        const moved = reduceMenu(state, "down");
        if (moved.type !== "continue") {
          throw new Error(`expected the cursor to move to ${label}`);
        }
        state = moved.state;
      }

      expect(reduceMenu(state, "confirm", { romFiles: ["b.gbc", "notes.txt", "a.gb"] })).toEqual({
        type: "continue",
        state: {
          ...createHomeState("braille"),
          screen: "rom",
          cursor: 0,
          roms: ["a.gb", "b.gbc"],
        },
      });
    });

    it("returns start with the selected rom path", () => {
      const state: MenuState = {
        ...createHomeState("braille-green"),
        screen: "rom",
        cursor: 1,
        roms: ["alpha.gb", "beta.gbc"],
      };

      expect(reduceMenu(state, "confirm")).toEqual({
        type: "start",
        format: "braille-green",
        controls: DEFAULT_CONTROLS,
        romPath: "/roms/beta.gbc",
      });
    });

    it("stays on the rom screen when the rom list is empty", () => {
      const state: MenuState = {
        ...createHomeState("braille"),
        screen: "rom",
        cursor: 0,
        roms: [],
      };

      expect(reduceMenu(state, "confirm")).toEqual({ type: "continue", state });
    });
  });

  describe("back", () => {
    it("keeps the previous format when leaving the render screen", () => {
      const state: MenuState = {
        ...createHomeState("braille"),
        screen: "render",
        cursor: 2,
      };

      expect(reduceMenu(state, "back")).toEqual({
        type: "continue",
        state: createHomeState("braille"),
      });
    });

    it("returns to home on Rom and keeps the format", () => {
      const state: MenuState = {
        ...createHomeState("braille-green"),
        screen: "rom",
        cursor: 0,
        roms: ["game.gb"],
      };

      expect(reduceMenu(state, "back")).toEqual({
        type: "continue",
        state: { ...createHomeState("braille-green"), cursor: 3 },
      });
    });

    it("quits from the home screen", () => {
      expect(reduceMenu(createHomeState("braille"), "back")).toEqual({ type: "quit" });
    });
  });

  describe("cursor movement", () => {
    const roms = ["a.gb", "b.gb", "c.gb"];

    it("wraps from the first row to the last row", () => {
      const state: MenuState = {
        ...createHomeState("braille"),
        screen: "rom",
        cursor: 0,
        roms,
      };

      expect(reduceMenu(state, "up")).toEqual({
        type: "continue",
        state: { ...state, cursor: 2 },
      });
    });

    it("wraps from the last row to the first row", () => {
      const state: MenuState = {
        ...createHomeState("braille"),
        screen: "rom",
        cursor: 2,
        roms,
      };

      expect(reduceMenu(state, "down")).toEqual({
        type: "continue",
        state: { ...state, cursor: 0 },
      });
    });
  });
});

describe("renderMenu", () => {
  it("shows the selected format beside Render", () => {
    expect(renderMenu(createHomeState("braille"))).toBe(
      "\x1b[38;2;155;188;15m> RENDER  braille\x1b[0m\n  CONTROLS\n  LIBRARY  /roms\n  ROM\n\nenter  open    esc  quit",
    );
  });

  it("shows an empty rom directory message", () => {
    const state: MenuState = {
      ...createHomeState("braille"),
      screen: "rom",
      cursor: 0,
      roms: [],
    };

    expect(renderMenu(state)).toBe("ROM\n\nno roms in this library\n\nesc  back");
  });

  it("shortens the library path on the home row", () => {
    const state = createHomeState(
      "braille",
      DEFAULT_CONTROLS,
      "/home/user/.local/share/gbt/roms",
      "/home/user",
    );

    expect(renderMenu(state)).toContain("LIBRARY  ~/.local/share/gbt/roms");
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
        ...createHomeState("braille"),
        screen: "controls",
        cursor: 0,
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
      ...createHomeState("braille"),
      screen: "controls",
      cursor: 8,
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
    expect(parseRomArg(["--rom=roms/game.gb"])).toBe("roms/game.gb");
  });

  it("throws when the rom flag has no value", () => {
    expect(() => parseRomArg(["--rom"])).toThrow("Missing value for --rom.");
  });
});

describe("library", () => {
  const session: MenuSession = {
    defaultRomsDirectory: "/home/user/.local/share/gbt/roms",
    launchDirectory: "/home/user/project",
    canOpenFolder: true,
  };

  function openLibrary(canOpenFolder = true) {
    const opened = reduceMenu(
      { ...createHomeState("braille"), cursor: 2 },
      "confirm",
      {},
      { ...session, canOpenFolder },
    );
    if (opened.type !== "continue" || opened.state.screen !== "library") {
      throw new Error("expected the library screen");
    }
    return opened.state;
  }

  it("shows the current folder and change", () => {
    expect(renderMenu(openLibrary(false))).toBe(
      "LIBRARY\n\n/roms\n\n\x1b[38;2;155;188;15m> change\x1b[0m\n\nenter  choose   esc  back",
    );
  });

  it("offers open folder when a file manager is available", () => {
    expect(renderMenu(openLibrary(true))).toContain("open folder");
  });

  it("asks to open the current library", () => {
    const library = { ...openLibrary(true), cursor: 1 };

    expect(reduceMenu(library, "confirm")).toEqual({
      type: "open-folder",
      directory: "/roms",
      state: library,
    });
  });

  it("returns home on Library", () => {
    expect(reduceMenu(openLibrary(), "back")).toEqual({
      type: "continue",
      state: { ...createHomeState("braille"), cursor: 2 },
    });
  });

  it("stores the default library and returns to Library", () => {
    const library = openLibrary();
    const places = reduceMenu(library, "confirm");
    if (places.type !== "continue" || places.state.screen !== "places") {
      throw new Error("expected places");
    }

    const chosen = reduceMenu({ ...places.state, cursor: 1 }, "confirm");

    expect(chosen).toEqual({
      type: "persist-library",
      romsDirectory: session.defaultRomsDirectory,
      state: {
        ...library,
        romsDirectory: session.defaultRomsDirectory,
      },
    });
  });

  it("opens Home in the directory browser", () => {
    const library = openLibrary();
    const places = reduceMenu(library, "confirm");
    if (places.type !== "continue") {
      throw new Error("expected places");
    }

    const step = reduceMenu(places.state, "confirm", { directories: ["Games", "Documents"] });
    if (step.type !== "continue" || step.state.screen !== "browse") {
      throw new Error("expected browse");
    }

    expect(step.state.directory).toBe("/home/user");
    expect(step.state.entries).toEqual(["Documents", "Games"]);
    expect(step.state.cursor).toBe(0);
  });

  it("opens the launch directory in the directory browser", () => {
    const library = openLibrary();
    const places = reduceMenu(library, "confirm");
    if (places.type !== "continue" || places.state.screen !== "places") {
      throw new Error("expected places");
    }

    expect(directoryToRead({ ...places.state, cursor: 2 })).toBe("/home/user/project");

    const step = reduceMenu({ ...places.state, cursor: 2 }, "confirm", { directories: ["roms"] });
    if (step.type !== "continue" || step.state.screen !== "browse") {
      throw new Error("expected browse");
    }

    expect(step.state.directory).toBe("/home/user/project");
    expect(step.state.entries).toEqual(["roms"]);
  });

  it("stores the browsed folder", () => {
    const library = openLibrary();
    const browse: MenuState = {
      ...library,
      screen: "browse",
      cursor: 0,
      directory: "/home/user/Games",
      entries: ["gb"],
    };

    expect(reduceMenu(browse, "confirm")).toEqual({
      type: "persist-library",
      romsDirectory: "/home/user/Games",
      state: { ...library, romsDirectory: "/home/user/Games" },
    });
  });

  it("enters a subdirectory", () => {
    const library = openLibrary();
    const browse: MenuState = {
      ...library,
      screen: "browse",
      cursor: 3,
      directory: "/home/user",
      entries: ["Documents", "Games"],
    };

    expect(directoryToRead(browse)).toBe("/home/user/Games");

    const step = reduceMenu(browse, "confirm", { directories: ["b", "a"] });
    if (step.type !== "continue" || step.state.screen !== "browse") {
      throw new Error("expected browse");
    }

    expect(step.state.directory).toBe("/home/user/Games");
    expect(step.state.entries).toEqual(["a", "b"]);
    expect(step.state.cursor).toBe(0);
  });

  it("moves to the parent directory", () => {
    const library = openLibrary();
    const browse: MenuState = {
      ...library,
      screen: "browse",
      cursor: 1,
      directory: "/home/user/Games",
      entries: ["gb"],
    };

    expect(directoryToRead(browse)).toBe("/home/user");

    const step = reduceMenu(browse, "confirm", { directories: ["Games", "Documents"] });
    if (step.type !== "continue" || step.state.screen !== "browse") {
      throw new Error("expected browse");
    }

    expect(step.state.directory).toBe("/home/user");
    expect(step.state.entries).toEqual(["Documents", "Games"]);
  });

  it("stays on the root when moving above it", () => {
    const library = openLibrary();
    const browse: MenuState = {
      ...library,
      screen: "browse",
      cursor: 1,
      directory: "/",
      entries: ["home"],
    };

    expect(directoryToRead(browse)).toBeUndefined();
    expect(reduceMenu(browse, "confirm")).toEqual({ type: "continue", state: browse });
  });
});
