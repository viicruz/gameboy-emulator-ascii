const GB_WIDTH = 160;
const GB_HEIGHT = 144;

export type BraillePalette = "ansi" | "green";

export type BrailleRenderOptions = {
  width?: number;
  palette?: BraillePalette;
};

//* All 256 braille characters, from empty (no dots) to full (all 8 dots).
const BRAILLE_GLYPHS = Array.from({ length: 256 }, (_, mask) =>
  String.fromCharCode(0x2800 + mask),
);

//* One character is 2 pixels wide and 4 tall. Unicode numbers the dots like this:
//*   1 4
//*   2 5
//*   3 6
//*   7 8
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

//* Repeating 4x4 grid: gray areas become a mix of dots on and off, not a hard black/white cut.
const BAYER_INDEX = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

const BAYER_4X4 = BAYER_INDEX.map((row) =>
  row.map((index) => Math.round(((index + 0.5) * 255) / 16)),
);

const GB_GREEN_PALETTE: readonly [number, number, number][] = [
  [155, 188, 15],
  [139, 172, 15],
  [48, 98, 48],
  [15, 56, 15],
];

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function samplePixel(fb: Uint8Array, srcX: number, srcY: number): number {
  const x = Math.min(Math.max(srcX, 0), GB_WIDTH - 1);
  const y = Math.min(Math.max(srcY, 0), GB_HEIGHT - 1);
  const i = (y * GB_WIDTH + x) * 4;
  return luminance(fb[i]!, fb[i + 1]!, fb[i + 2]!);
}

function lumToAnsiGray(lum: number): number {
  return 232 + Math.round((lum / 255) * 23);
}

function lumToGBGreen(lum: number): readonly [number, number, number] {
  if (lum > 224) return GB_GREEN_PALETTE[0]!;
  if (lum > 144) return GB_GREEN_PALETTE[1]!;
  if (lum > 48) return GB_GREEN_PALETTE[2]!;
  return GB_GREEN_PALETTE[3]!;
}

function ansiForeground(lum: number, palette: BraillePalette): string {
  if (palette === "green") {
    const [r, g, b] = lumToGBGreen(lum);
    return `\x1b[38;2;${r};${g};${b}m`;
  }

  return `\x1b[38;5;${lumToAnsiGray(lum)}m`;
}

/**
 * Draw one Game Boy frame as braille text.
 * Each character covers 8 pixels and uses one foreground color for the whole cell.
 */
export function renderBraille(
  fb: Uint8Array,
  options: BrailleRenderOptions = {},
): string {
  const width = options.width ?? 80;
  const palette = options.palette ?? "ansi";
  const cols = Math.max(1, width);
  const rows = Math.max(1, Math.round((cols * 9) / 20));
  const xStep = GB_WIDTH / (2 * cols);
  const yStep = GB_HEIGHT / (4 * rows);
  const lines: string[] = [];

  for (let row = 0; row < rows; row++) {
    let line = "";
    let prevColor = "";

    for (let col = 0; col < cols; col++) {
      let mask = 0;
      let lumSum = 0;

      for (let dy = 0; dy < 4; dy++) {
        const srcY = Math.min(Math.floor((row * 4 + dy) * yStep), GB_HEIGHT - 1);

        for (let dx = 0; dx < 2; dx++) {
          const srcX = Math.min(Math.floor((col * 2 + dx) * xStep), GB_WIDTH - 1);
          const lum = samplePixel(fb, srcX, srcY);
          lumSum += lum;

          const threshold = BAYER_4X4[srcY & 3]![srcX & 3]!;
          if (lum > threshold) {
            mask |= DOT_BITS[dy]![dx]!;
          }
        }
      }

      const color = ansiForeground(Math.round(lumSum / 8), palette);
      if (color !== prevColor) {
        line += color;
        prevColor = color;
      }

      line += BRAILLE_GLYPHS[mask]!;
    }

    line += "\x1b[0m";
    lines.push(line);
  }

  return lines.join("\n");
}
