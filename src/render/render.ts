//* Render imports
import { renderBraille } from "./render-braille.ts";

export const LOCAL_RENDER_FORMATS = ["braille", "braille-green"] as const;

export type AppRenderFormat = (typeof LOCAL_RENDER_FORMATS)[number];

export type RenderArgs = {
  format: AppRenderFormat;
  width: number;
  maxWidth?: number;
};

const DEFAULT_RENDER_ARGS: RenderArgs = {
  format: "braille",
  width: 80,
};

function isAppRenderFormat(value: string): value is AppRenderFormat {
  return (LOCAL_RENDER_FORMATS as readonly string[]).includes(value);
}

function readFlagValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const current = argv[index]!;
  const inline = current.slice(flag.length + 1);
  if (current.startsWith(`${flag}=`)) {
    return { value: inline, nextIndex: index };
  }

  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return { value: next, nextIndex: index + 1 };
}

export function parseRenderArgs(
  argv: string[],
  defaults: RenderArgs = DEFAULT_RENDER_ARGS,
): RenderArgs {
  let format = defaults.format;
  let width = defaults.width;
  let maxWidth = defaults.maxWidth;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--format" || arg.startsWith("--format=")) {
      const { value, nextIndex } = readFlagValue(argv, i, "--format");
      if (!isAppRenderFormat(value)) {
        throw new Error(`Invalid --format: ${value}.`);
      }
      format = value;
      i = nextIndex;
      continue;
    }

    if (arg === "--width" || arg.startsWith("--width=")) {
      const { value, nextIndex } = readFlagValue(argv, i, "--width");
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid --width: ${value}.`);
      }
      width = parsed;
      maxWidth = parsed;
      i = nextIndex;
    }
  }

  return maxWidth === undefined ? { format, width } : { format, width, maxWidth };
}

function brailleRows(cols: number): number {
  return Math.max(1, Math.round((cols * 9) / 20));
}

export function fitBrailleColumns(
  termCols: number,
  termRows: number,
  maxCols?: number,
): number {
  const widthLimit = maxCols === undefined ? termCols : Math.min(termCols, maxCols);
  let cols = Math.max(1, Math.min(widthLimit, Math.floor((termRows * 20) / 9)));

  while (cols > 1 && brailleRows(cols) > termRows) {
    cols -= 1;
  }

  return cols;
}

export function centerFrame(
  frame: string,
  frameCols: number,
  termCols: number,
  termRows: number,
): string {
  const lines = frame.split("\n");
  const left = Math.max(0, Math.floor((termCols - frameCols) / 2));
  const top = Math.max(0, Math.floor((termRows - lines.length) / 2));
  const pad = " ".repeat(left);
  const topPad = "\x1b[K\n".repeat(top);
  const body = lines.map((line) => `${pad}${line}\x1b[K`).join("\n");

  return `${topPad}${body}\x1b[J`;
}

export function renderFrame(
  fb: Uint8Array,
  format: AppRenderFormat,
  width: number,
): string {
  switch (format) {
    case "braille":
      return renderBraille(fb, { width, palette: "ansi" });
    case "braille-green":
      return renderBraille(fb, { width, palette: "green" });
  }
}
