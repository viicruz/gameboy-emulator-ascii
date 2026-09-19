//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Render imports
import { parseRenderArgs, renderFrame } from "./render.ts";
import { renderBraille } from "./render-braille.ts";

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
    });
  });

  it("reads inline format and width flags", () => {
    expect(parseRenderArgs(["--format=braille-green", "--width=40"])).toEqual({
      format: "braille-green",
      width: 40,
    });
  });

  it("throws when the format is not supported", () => {
    expect(() => parseRenderArgs(["--format", "quads"])).toThrow("Invalid --format: quads.");
  });
});

describe("renderFrame", () => {
  it("dispatches braille-green to the local renderer", () => {
    const frame = renderFrame(makeFramebuffer(255), "braille-green", 80);

    expect(frame.startsWith("\x1b[38;2;155;188;15m")).toBe(true);
    expect(visibleLines(frame)).toHaveLength(36);
  });
});
