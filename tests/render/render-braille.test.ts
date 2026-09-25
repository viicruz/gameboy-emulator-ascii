//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Render imports
import { centerFrame, fitBrailleColumns, parseRenderArgs, renderFrame } from "../../src/render/render.ts";
import { renderBraille } from "../../src/render/render-braille.ts";

const GB_WIDTH = 160;
const GB_HEIGHT = 144;

function makeFramebuffer(fill: number): Uint8Array {
  const fb = new Uint8Array(GB_WIDTH * GB_HEIGHT * 4);
  for (let i = 0; i < fb.length; i += 4) {
    fb[i] = fill;
    fb[i + 1] = fill;
    fb[i + 2] = fill;
    fb[i + 3] = 255;
  }
  return fb;
}

function setPixel(fb: Uint8Array, x: number, y: number, lum: number): void {
  const i = (y * GB_WIDTH + x) * 4;
  fb[i] = lum;
  fb[i + 1] = lum;
  fb[i + 2] = lum;
  fb[i + 3] = 255;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLines(frame: string): string[] {
  return stripAnsi(frame).split("\n");
}

describe("renderBraille", () => {
  describe("native dimensions", () => {
    it("renders 80 columns and 36 rows at the default width", () => {
      const frame = renderBraille(makeFramebuffer(0));
      const lines = visibleLines(frame);

      expect(lines).toHaveLength(36);
      expect(lines.every((line) => line.length === 80)).toBe(true);
    });

    it("scales to 100 columns and 45 rows", () => {
      const frame = renderBraille(makeFramebuffer(0), { width: 100 });
      const lines = visibleLines(frame);

      expect(lines).toHaveLength(45);
      expect(lines.every((line) => line.length === 100)).toBe(true);
    });
  });

  describe("glyph packing", () => {
    it("maps a known 2x4 pixel block to the matching braille codepoint", () => {
      const fb = makeFramebuffer(0);
      setPixel(fb, 0, 0, 255);
      setPixel(fb, 1, 1, 255);
      setPixel(fb, 0, 2, 255);
      setPixel(fb, 1, 3, 255);

      const lines = visibleLines(renderBraille(fb));
      const mask = 0x01 | 0x10 | 0x04 | 0x80;

      expect(lines[0]![0]).toBe(String.fromCharCode(0x2800 + mask));
    });

    it("renders a full cell of white pixels as ⣿", () => {
      const fb = makeFramebuffer(0);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 2; x++) {
          setPixel(fb, x, y, 255);
        }
      }

      const lines = visibleLines(renderBraille(fb));

      expect(lines[0]![0]).toBe("⣿");
    });

    it("renders a uniform black framebuffer as blank braille cells", () => {
      const lines = visibleLines(renderBraille(makeFramebuffer(0)));

      expect(lines[0]![0]).toBe("⠀");
      expect(lines.every((line) => [...line].every((ch) => ch === "⠀"))).toBe(true);
    });
  });

  describe("foreground color", () => {
    it("uses ANSI gray 255 for a uniform white framebuffer", () => {
      const frame = renderBraille(makeFramebuffer(255));

      expect(frame.startsWith("\x1b[38;5;255m")).toBe(true);
      expect(visibleLines(frame)[0]![0]).toBe("⣿");
    });

    it("uses ANSI gray 232 for a uniform black framebuffer", () => {
      const frame = renderBraille(makeFramebuffer(0));

      expect(frame.startsWith("\x1b[38;5;232m")).toBe(true);
    });

    it("uses the lightest DMG green on a white framebuffer", () => {
      const frame = renderBraille(makeFramebuffer(255), { palette: "green" });

      expect(frame.startsWith("\x1b[38;2;155;188;15m")).toBe(true);
    });

    it("resets ANSI color at the end of each line", () => {
      const lines = renderBraille(makeFramebuffer(255)).split("\n");

      expect(lines.every((line) => line.endsWith("\x1b[0m"))).toBe(true);
    });
  });
});

describe("parseRenderArgs", () => {
  it("defaults to braille at native width 80", () => {
    expect(parseRenderArgs([])).toEqual({ format: "braille", width: 80 });
  });

  it("reads space-separated format and width flags", () => {
    expect(parseRenderArgs(["--format", "ansi-half", "--width", "100"])).toEqual({
      format: "ansi-half",
      width: 100,
      maxWidth: 100,
    });
  });

  it("reads inline format and width flags", () => {
    expect(parseRenderArgs(["--format=braille-green", "--width=40"])).toEqual({
      format: "braille-green",
      width: 40,
      maxWidth: 40,
    });
  });

  it("throws when the format is not supported", () => {
    expect(() => parseRenderArgs(["--format", "quads"])).toThrow("Invalid --format: quads.");
  });

  it("uses a custom default format unless the format flag overrides it", () => {
    const defaults = { format: "green" as const, width: 80 };

    expect(parseRenderArgs([], defaults)).toEqual({ format: "green", width: 80 });
    expect(parseRenderArgs(["--format", "ascii"], defaults)).toEqual({
      format: "ascii",
      width: 80,
    });
  });
});

describe("renderFrame", () => {
  it("dispatches braille-green to the local renderer", () => {
    const frame = renderFrame(makeFramebuffer(255), "braille-green", 80);

    expect(frame.startsWith("\x1b[38;2;155;188;15m")).toBe(true);
    expect(visibleLines(frame)).toHaveLength(36);
  });
});

describe("centerFrame", () => {
  const frame = "AB\nCD";

  it("pads each line so an 80-column frame sits in the middle of a wider terminal", () => {
    const centered = centerFrame("AB", 80, 100, 1);
    const line = centered.replace("\x1b[K", "").replace("\x1b[J", "");

    expect(line.startsWith(" ".repeat(10))).toBe(true);
    expect(line.trimStart()).toBe("AB");
  });

  it("inserts blank rows so the frame sits in the middle of a taller terminal", () => {
    const centered = centerFrame(frame, 2, 2, 6);
    const rows = centered.replace("\x1b[J", "").split("\n");

    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe("\x1b[K");
    expect(rows[1]).toBe("\x1b[K");
    expect(rows[2]).toBe("AB\x1b[K");
    expect(rows[3]).toBe("CD\x1b[K");
  });

  it("leaves the frame at the origin when the terminal is smaller than the frame", () => {
    const centered = centerFrame(frame, 80, 40, 1);

    expect(centered.startsWith("AB")).toBe(true);
    expect(centered.includes("\n\x1b[K\n")).toBe(false);
  });

  it("clears the rest of each line and the area below the frame", () => {
    const centered = centerFrame(frame, 2, 4, 4);

    expect(centered).toBe("\x1b[K\n AB\x1b[K\n CD\x1b[K\x1b[J");
  });
});

describe("fitBrailleColumns", () => {
  it("fits a 5000 by 100 terminal into 222 columns", () => {
    expect(fitBrailleColumns(5000, 100)).toBe(222);
  });

  it("stays at 50 columns when the terminal width is the limit", () => {
    expect(fitBrailleColumns(50, 40)).toBe(50);
  });

  it("stays within the height of a 200 by 50 terminal", () => {
    expect(fitBrailleColumns(200, 50)).toBe(111);
  });

  it("does not exceed a max column cap of 40", () => {
    expect(fitBrailleColumns(5000, 100, 40)).toBe(40);
  });

  it("returns 1 column for a 1 by 1 terminal", () => {
    expect(fitBrailleColumns(1, 1)).toBe(1);
  });
});
