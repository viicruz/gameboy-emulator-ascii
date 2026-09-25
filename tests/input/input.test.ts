//* Libraries imports
import { describe, expect, it } from "bun:test";
import { Button } from "gboy-ts";

//* Controls imports
import { assignBinding, DEFAULT_CONTROLS } from "../../src/input/controls.ts";

//* Input imports
import { InputParser } from "../../src/input/input.ts";

describe("InputParser", () => {
  describe("legacy keys", () => {
    it("maps z to button A as a press", () => {
      const parser = new InputParser();

      expect(parser.feed("z")).toEqual([
        { kind: "key", button: Button.A, type: "press" },
      ]);
    });

    it("maps a CSI arrow sequence to a press", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[A")).toEqual([
        { kind: "key", button: Button.Up, type: "press" },
      ]);
    });

    it("treats q as quit on press", () => {
      const parser = new InputParser();

      expect(parser.feed("q")).toEqual([{ kind: "quit", type: "press" }]);
    });

    it("treats Ctrl+C as quit on press", () => {
      const parser = new InputParser();

      expect(parser.feed("\x03")).toEqual([{ kind: "quit", type: "press" }]);
    });
  });

  describe("kitty protocol", () => {
    it("parses a z release event", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[122;1:3u")).toEqual([
        { kind: "key", button: Button.A, type: "release" },
      ]);
    });

    it("parses an arrow release event", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[1;1:3A")).toEqual([
        { kind: "key", button: Button.Up, type: "release" },
      ]);
    });

    it("parses a z repeat event", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[122;1:2u")).toEqual([
        { kind: "key", button: Button.A, type: "repeat" },
      ]);
    });

    it("parses protocol flags", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[?11u")).toEqual([
        { kind: "protocolFlags", flags: 11 },
      ]);
    });

    it("parses primary device attributes", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[?64;1;2;6c")).toEqual([
        { kind: "deviceAttributes" },
      ]);
    });

    it("parses Ctrl+C as quit when encoded as CSI u", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[99;5u")).toEqual([
        { kind: "quit", type: "press" },
      ]);
    });

    it("does not quit when q is released", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[113;1:3u")).toEqual([
        { kind: "quit", type: "release" },
      ]);
    });

    it("buffers an incomplete CSI sequence until the final byte arrives", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[122;1:")).toEqual([]);
      expect(parser.feed("3u")).toEqual([
        { kind: "key", button: Button.A, type: "release" },
      ]);
    });

    it("maps a custom letter in both legacy and kitty forms", () => {
      const parser = new InputParser(assignBinding(DEFAULT_CONTROLS, "up", { kind: "char", value: "w" }));

      expect(parser.feed("w")).toEqual([{ kind: "key", button: Button.Up, type: "press" }]);
      expect(parser.feed("\x1b[119;1u")).toEqual([{ kind: "key", button: Button.Up, type: "press" }]);
    });

    it("stops treating the up arrow as Up after that button is rebound", () => {
      const parser = new InputParser(assignBinding(DEFAULT_CONTROLS, "up", { kind: "char", value: "w" }));

      expect(parser.feed("\x1b[A")).toEqual([]);
    });

    it("parses multiple events from a single chunk", () => {
      const parser = new InputParser();

      expect(parser.feed("\x1b[?11u\x1b[?1;2c\x1b[122u")).toEqual([
        { kind: "protocolFlags", flags: 11 },
        { kind: "deviceAttributes" },
        { kind: "key", button: Button.A, type: "press" },
      ]);
    });
  });
});
