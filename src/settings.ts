//* Libraries imports
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

//* Render imports
import {
  GBOY_RENDER_FORMATS,
  LOCAL_RENDER_FORMATS,
  type AppRenderFormat,
} from "./render.ts";

const SETTINGS_PATH = "saves/settings.json";

const DEFAULT_SETTINGS: Settings = {
  format: "braille",
};

export type Settings = {
  format: AppRenderFormat;
};

export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) {
    return { format: DEFAULT_SETTINGS.format };
  }

  const format = (raw as { format?: unknown }).format;
  if (!isAppRenderFormat(format)) {
    return { format: DEFAULT_SETTINGS.format };
  }

  return { format };
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
  return (
    typeof value === "string" &&
    ((GBOY_RENDER_FORMATS as readonly string[]).includes(value) ||
      (LOCAL_RENDER_FORMATS as readonly string[]).includes(value))
  );
}
