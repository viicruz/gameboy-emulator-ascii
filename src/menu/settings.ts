//* Libraries imports
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute } from "node:path";

//* Controls imports
import { cloneControls, DEFAULT_CONTROLS, parseControls, type Controls } from "../input/controls.ts";

//* Paths imports
import { appPaths } from "../paths/paths.ts";

//* Render imports
import { LOCAL_RENDER_FORMATS, type AppRenderFormat } from "../render/render.ts";

const DEFAULT_SETTINGS: Settings = {
  format: "braille",
  controls: DEFAULT_CONTROLS,
};

export type Settings = {
  format: AppRenderFormat;
  controls: Controls;
  romsDirectory?: string;
};

export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) {
    return { format: DEFAULT_SETTINGS.format, controls: cloneControls(DEFAULT_CONTROLS) };
  }

  const record = raw as { format?: unknown; controls?: unknown; romsDirectory?: unknown };
  const format = isAppRenderFormat(record.format) ? record.format : DEFAULT_SETTINGS.format;
  const controls = parseControls(record.controls);
  const romsDirectory = parseRomsDirectory(record.romsDirectory);
  if (romsDirectory === undefined) {
    return { format, controls };
  }
  return { format, controls, romsDirectory };
}

export async function readSettings(filePath = defaultSettingsPath()): Promise<Settings> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return parseSettings(undefined);
    }
    return parseSettings(JSON.parse(await file.text()));
  } catch {
    return parseSettings(undefined);
  }
}

export async function writeSettings(settings: Settings, filePath = defaultSettingsPath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  try {
    await writeFile(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
    await rename(tmpPath, filePath);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
}

function defaultSettingsPath(): string {
  return appPaths({
    platform: process.platform,
    home: homedir(),
    env: process.env,
  }).settingsPath;
}

function parseRomsDirectory(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    return undefined;
  }
  return value;
}

function isAppRenderFormat(value: unknown): value is AppRenderFormat {
  return typeof value === "string" && (LOCAL_RENDER_FORMATS as readonly string[]).includes(value);
}
