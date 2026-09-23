//* Libraries imports
import { renderFramebuffer, type RenderFormat } from "gboy-ts";

//* Render imports
import { renderBraille } from "./render-braille.ts";

export const GBOY_RENDER_FORMATS = [
  "ansi",
  "ansi-half",
  "green",
  "green-half",
  "ascii",
  "blocks",
  "half-blocks",
] as const satisfies readonly RenderFormat[];

export const LOCAL_RENDER_FORMATS = ["braille", "braille-green"] as const;

export type AppRenderFormat =
  | (typeof GBOY_RENDER_FORMATS)[number]
  | (typeof LOCAL_RENDER_FORMATS)[number];

export type RenderArgs = {
  format: AppRenderFormat;
  width: number;
};

const DEFAULT_RENDER_ARGS: RenderArgs = {
  format: "braille",
  width: 80,
};

function isAppRenderFormat(value: string): value is AppRenderFormat {
  return (
    (GBOY_RENDER_FORMATS as readonly string[]).includes(value) ||
    (LOCAL_RENDER_FORMATS as readonly string[]).includes(value)
  );
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
      i = nextIndex;
    }
  }

  return { format, width };
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
    default:
      return renderFramebuffer(fb, format, width);
  }
}
