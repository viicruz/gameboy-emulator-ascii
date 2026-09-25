//* Libraries imports
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

//* Controls imports
import { cloneControls, DEFAULT_CONTROLS, parseControls, type Controls } from "../input/controls.ts";

//* Render imports
import { LOCAL_RENDER_FORMATS, type AppRenderFormat } from "../render/render.ts";

const SETTINGS_PATH = "saves/settings.json";

const DEFAULT_SETTINGS: Settings = {
  format: "braille",
  controls: DEFAULT_CONTROLS,
};

export type Settings = {
  format: AppRenderFormat;
  controls: Controls;
};

export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) {
    return { format: DEFAULT_SETTINGS.format, controls: cloneControls(DEFAULT_CONTROLS) };
  }

  const record = raw as { format?: unknown; controls?: unknown };
  const format = isAppRenderFormat(record.format) ? record.format : DEFAULT_SETTINGS.format;
  return { format, controls: parseControls(record.controls) };
}

export async function readSettings(filePath = SETTINGS_PATH): Promise<Settings> {
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

export async function writeSettings(settings: Settings, filePath = SETTINGS_PATH): Promise<void> {
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

function isAppRenderFormat(value: unknown): value is AppRenderFormat {
  return typeof value === "string" && (LOCAL_RENDER_FORMATS as readonly string[]).includes(value);
}
