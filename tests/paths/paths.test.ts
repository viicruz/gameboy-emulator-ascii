//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Paths imports
import {
  appPaths,
  canOpenFolder,
  resolveRomsDirectory,
  shortenHome,
  storedRomsDirectory,
} from "../../src/paths/paths.ts";

describe("appPaths", () => {
  it("uses XDG directories on linux when they are set", () => {
    expect(
      appPaths({
        platform: "linux",
        home: "/home/user",
        env: { XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "/data" },
      }),
    ).toEqual({
      settingsPath: "/cfg/gbt/settings.json",
      defaultRomsDirectory: "/data/gbt/roms",
      savesDirectory: "/data/gbt/saves",
    });
  });

  it("falls back to the home directory on linux", () => {
    expect(
      appPaths({
        platform: "linux",
        home: "/home/user",
        env: {},
      }),
    ).toEqual({
      settingsPath: "/home/user/.config/gbt/settings.json",
      defaultRomsDirectory: "/home/user/.local/share/gbt/roms",
      savesDirectory: "/home/user/.local/share/gbt/saves",
    });
  });

  it("ignores empty XDG variables on linux", () => {
    expect(
      appPaths({
        platform: "linux",
        home: "/home/user",
        env: { XDG_CONFIG_HOME: "", XDG_DATA_HOME: "" },
      }).settingsPath,
    ).toBe("/home/user/.config/gbt/settings.json");
  });

  it("uses APPDATA and LOCALAPPDATA on windows", () => {
    expect(
      appPaths({
        platform: "win32",
        home: "C:\\Users\\user",
        env: {
          APPDATA: "C:\\Users\\user\\AppData\\Roaming",
          LOCALAPPDATA: "C:\\Users\\user\\AppData\\Local",
        },
      }),
    ).toEqual({
      settingsPath: "C:\\Users\\user\\AppData\\Roaming\\gbt\\settings.json",
      defaultRomsDirectory: "C:\\Users\\user\\AppData\\Local\\gbt\\roms",
      savesDirectory: "C:\\Users\\user\\AppData\\Local\\gbt\\saves",
    });
  });

  it("falls back to AppData under home on windows", () => {
    expect(
      appPaths({
        platform: "win32",
        home: "C:\\Users\\user",
        env: {},
      }),
    ).toEqual({
      settingsPath: "C:\\Users\\user\\AppData\\Roaming\\gbt\\settings.json",
      defaultRomsDirectory: "C:\\Users\\user\\AppData\\Local\\gbt\\roms",
      savesDirectory: "C:\\Users\\user\\AppData\\Local\\gbt\\saves",
    });
  });
});

describe("resolveRomsDirectory", () => {
  it("keeps an absolute directory", () => {
    expect(resolveRomsDirectory("/games/gb", "/default", "linux")).toBe("/games/gb");
  });

  it("uses the default when the stored directory is missing", () => {
    expect(resolveRomsDirectory(undefined, "/default", "linux")).toBe("/default");
  });

  it("uses the default when the stored directory is relative", () => {
    expect(resolveRomsDirectory("roms", "/default", "linux")).toBe("/default");
  });

  it("keeps a windows absolute directory", () => {
    expect(resolveRomsDirectory("D:\\games\\gb", "C:\\default", "win32")).toBe("D:\\games\\gb");
  });
});

describe("storedRomsDirectory", () => {
  it("omits the stored directory when the choice is the default library", () => {
    expect(storedRomsDirectory("/data/gbt/roms", "/data/gbt/roms")).toBeUndefined();
  });

  it("keeps a chosen directory that is not the default library", () => {
    expect(storedRomsDirectory("/games/gb", "/data/gbt/roms")).toBe("/games/gb");
  });
});

describe("canOpenFolder", () => {
  it("is available on windows", () => {
    expect(canOpenFolder("win32", {})).toBe(true);
  });

  it("is available on linux when a display is set", () => {
    expect(canOpenFolder("linux", { DISPLAY: ":0" })).toBe(true);
    expect(canOpenFolder("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
  });

  it("is unavailable on linux without a display", () => {
    expect(canOpenFolder("linux", {})).toBe(false);
  });
});

describe("shortenHome", () => {
  it("replaces the home prefix", () => {
    expect(shortenHome("/home/user/.local/share/gbt/roms", "/home/user")).toBe("~/.local/share/gbt/roms");
  });

  it("replaces the home directory itself", () => {
    expect(shortenHome("/home/user", "/home/user")).toBe("~");
  });

  it("leaves a path outside home unchanged", () => {
    expect(shortenHome("/games/gb", "/home/user")).toBe("/games/gb");
  });
});
