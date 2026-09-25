//* Libraries imports
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

//* Controls imports
import { DEFAULT_CONTROLS } from "../../src/input/controls.ts";

//* Settings imports
import { parseSettings, readSettings, writeSettings } from "../../src/menu/settings.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gboy-settings-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseSettings", () => {
  it("keeps a known format", () => {
    expect(parseSettings({ format: "blocks" })).toEqual({
      format: "blocks",
      controls: DEFAULT_CONTROLS,
    });
  });

  it("falls back to braille when the value is not settings", () => {
    expect(parseSettings(null)).toEqual({ format: "braille", controls: DEFAULT_CONTROLS });
    expect(parseSettings("braille-green")).toEqual({ format: "braille", controls: DEFAULT_CONTROLS });
    expect(parseSettings({})).toEqual({ format: "braille", controls: DEFAULT_CONTROLS });
  });

  it("keeps valid controls when the format name is unknown", () => {
    expect(
      parseSettings({
        format: "quads",
        controls: { a: [{ kind: "char", value: "w" }] },
      }).controls.a,
    ).toEqual([{ kind: "char", value: "w" }]);
  });

  it("falls back to braille when the format name is unknown", () => {
    expect(parseSettings({ format: "quads" })).toEqual({
      format: "braille",
      controls: DEFAULT_CONTROLS,
    });
  });
});

describe("readSettings", () => {
  it("falls back to braille when the file is missing", async () => {
    const dir = await makeTempDir();

    expect(await readSettings(join(dir, "settings.json"))).toEqual({
      format: "braille",
      controls: DEFAULT_CONTROLS,
    });
  });

  it("falls back to braille when the file is not valid JSON", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "settings.json");
    await writeFile(filePath, "{");

    expect(await readSettings(filePath)).toEqual({
      format: "braille",
      controls: DEFAULT_CONTROLS,
    });
  });
});

describe("writeSettings", () => {
  it("round-trips the format through readSettings", async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, "nested", "settings.json");

    await writeSettings(
      {
        format: "ansi-half",
        controls: { ...DEFAULT_CONTROLS, a: [{ kind: "char", value: "w" }] },
      },
      filePath,
    );

    expect(await readSettings(filePath)).toEqual({
      format: "ansi-half",
      controls: { ...DEFAULT_CONTROLS, a: [{ kind: "char", value: "w" }] },
    });
  });
});
