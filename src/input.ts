//* Libraries imports
import { Button } from "gboy-ts";

export type KeyEventType = "press" | "repeat" | "release";

type ButtonTarget = {
  pressButton(button: Button): void;
  releaseButton(button: Button): void;
};

type ParserEvent =
  | { kind: "quit"; type: KeyEventType }
  | { kind: "key"; button: Button; type: KeyEventType }
  | { kind: "protocolFlags"; flags: number }
  | { kind: "deviceAttributes" };

type LegacyHoldState = {
  eventCount: number;
  lastAt: number;
};

const ALL_BUTTONS: Button[] = [
  Button.Up,
  Button.Down,
  Button.Left,
  Button.Right,
  Button.A,
  Button.B,
  Button.Select,
  Button.Start,
];

//* Kitty flags: disambiguate (1) + event types (2) + all keys as CSI u (8)
const PROTOCOL_FLAGS = 11;
const REPORT_EVENTS = 0b10;
const REPORT_ALL_KEYS = 0b1000;
const HANDSHAKE_TIMEOUT_MS = 100;
//* Fallback only: cover the OS key-repeat delay, then the repeat interval.
//* Taps can feel sticky in this mode; protocol press/release does not use it.
const INITIAL_REPEAT_MS = 350;
const REPEAT_HOLD_MS = 80;
const MAX_CSI_LENGTH = 256;

const CODEPOINT_TO_BUTTON: Record<number, Button> = {
  122: Button.A,
  90: Button.A,
  97: Button.A,
  65: Button.A,
  120: Button.B,
  88: Button.B,
  115: Button.B,
  83: Button.B,
  32: Button.Select,
  13: Button.Start,
};

const ARROW_FINAL_TO_BUTTON: Record<string, Button> = {
  A: Button.Up,
  B: Button.Down,
  C: Button.Right,
  D: Button.Left,
};

const LEGACY_KEY_TO_BUTTON: Record<string, Button> = {
  z: Button.A,
  Z: Button.A,
  a: Button.A,
  A: Button.A,
  x: Button.B,
  X: Button.B,
  s: Button.B,
  S: Button.B,
  " ": Button.Select,
  "\r": Button.Start,
  "\n": Button.Start,
};

export class InputParser {
  private buffer = "";

  feed(chunk: string): ParserEvent[] {
    this.buffer += chunk;
    const events: ParserEvent[] = [];
    let index = 0;

    while (index < this.buffer.length) {
      const parsed = this.nextEvent(index);
      if (parsed === "incomplete") {
        break;
      }
      events.push(...parsed.events);
      index = parsed.nextIndex;
    }

    this.buffer = this.buffer.slice(index);
    return events;
  }

  private nextEvent(
    index: number,
  ): { events: ParserEvent[]; nextIndex: number } | "incomplete" {
    const current = this.buffer[index];
    if (current !== "\x1b") {
      const event = this.legacyChar(current ?? "");
      return { events: event ? [event] : [], nextIndex: index + 1 };
    }

    if (index + 1 >= this.buffer.length) {
      return "incomplete";
    }

    const second = this.buffer[index + 1];
    if (second === "[") {
      return this.parseCsi(index);
    }
    if (second === "O") {
      return this.parseSs3(index);
    }

    return { events: [], nextIndex: index + 1 };
  }

  private parseCsi(
    start: number,
  ): { events: ParserEvent[]; nextIndex: number } | "incomplete" {
    const bodyStart = start + 2;
    for (let index = bodyStart; index < this.buffer.length; index++) {
      const code = this.buffer.charCodeAt(index);
      if (code < 0x40 || code > 0x7e) {
        continue;
      }

      const params = this.buffer.slice(bodyStart, index);
      const final = this.buffer[index] ?? "";
      const event = this.csiEvent(params, final);
      return {
        events: event ? [event] : [],
        nextIndex: index + 1,
      };
    }

    if (this.buffer.length - start > MAX_CSI_LENGTH) {
      return { events: [], nextIndex: start + 1 };
    }

    return "incomplete";
  }

  private parseSs3(
    start: number,
  ): { events: ParserEvent[]; nextIndex: number } | "incomplete" {
    if (start + 2 >= this.buffer.length) {
      return "incomplete";
    }

    const final = this.buffer[start + 2] ?? "";
    const button = ARROW_FINAL_TO_BUTTON[final];
    if (button === undefined) {
      return { events: [], nextIndex: start + 3 };
    }

    return {
      events: [{ kind: "key", button, type: "press" }],
      nextIndex: start + 3,
    };
  }

  private csiEvent(params: string, final: string): ParserEvent | null {
    if (final === "u" && params.startsWith("?")) {
      const flags = Number.parseInt(params.slice(1), 10);
      if (Number.isNaN(flags)) {
        return null;
      }
      return { kind: "protocolFlags", flags };
    }

    if (final === "c" && (params.startsWith("?") || params.length === 0)) {
      return { kind: "deviceAttributes" };
    }

    if (final === "u") {
      return this.csiUEvent(params);
    }

    const arrow = ARROW_FINAL_TO_BUTTON[final];
    if (arrow !== undefined) {
      const fields = params.split(";");
      const type = eventTypeFromField(fields[1] ?? fields[0]);
      return { kind: "key", button: arrow, type };
    }

    return null;
  }

  private csiUEvent(params: string): ParserEvent | null {
    const fields = params.split(";");
    const keyCode = Number.parseInt(fields[0]?.split(":")[0] ?? "", 10);
    if (Number.isNaN(keyCode)) {
      return null;
    }

    const type = eventTypeFromField(fields[1]);
    const modifiers = modifierFromField(fields[1]);

    if (keyCode === 113 || keyCode === 81) {
      return { kind: "quit", type };
    }
    if (keyCode === 99 && (modifiers & 4) !== 0) {
      return { kind: "quit", type };
    }

    const button = CODEPOINT_TO_BUTTON[keyCode];
    if (button === undefined) {
      return null;
    }

    return { kind: "key", button, type };
  }

  private legacyChar(char: string): ParserEvent | null {
    if (char === "\x03" || char === "q" || char === "Q") {
      return { kind: "quit", type: "press" };
    }

    const button = LEGACY_KEY_TO_BUTTON[char];
    if (button === undefined) {
      return null;
    }

    return { kind: "key", button, type: "press" };
  }
}

function eventTypeFromField(field: string | undefined): KeyEventType {
  if (field === undefined) {
    return "press";
  }

  const typePart = field.split(":")[1];
  if (typePart === "2") {
    return "repeat";
  }
  if (typePart === "3") {
    return "release";
  }
  return "press";
}

function modifierFromField(field: string | undefined): number {
  if (field === undefined) {
    return 1;
  }

  const value = Number.parseInt(field.split(":")[0] ?? "1", 10);
  return Number.isNaN(value) ? 1 : value;
}

function protocolSupported(flags: number): boolean {
  return (flags & REPORT_EVENTS) !== 0 && (flags & REPORT_ALL_KEYS) !== 0;
}

export class JoypadInput {
  private readonly parser = new InputParser();
  private readonly protocolHeld = new Set<Button>();
  private readonly legacyHeld = new Map<Button, LegacyHoldState>();
  private readonly onQuit: () => void;
  private readonly pendingEvents: ParserEvent[] = [];
  private handshakeDone = false;
  private handshakeFlags = 0;
  private gotProtocolFlags = false;
  private handshakeResolve: (() => void) | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  usesProtocol = false;

  constructor(onQuit: () => void) {
    this.onQuit = onQuit;
  }

  async start(): Promise<void> {
    process.stdin.on("data", this.onData);
    process.stdout.write(`\x1b[>${PROTOCOL_FLAGS}u\x1b[?u\x1b[c`);

    await new Promise<void>((resolve) => {
      this.handshakeResolve = resolve;
      this.handshakeTimer = setTimeout(() => {
        this.finishHandshake();
      }, HANDSHAKE_TIMEOUT_MS);
    });
  }

  stop(): void {
    process.stdin.off("data", this.onData);
    process.stdout.write("\x1b[<u");
  }

  apply(emulator: ButtonTarget, now: number): void {
    if (this.usesProtocol) {
      for (const button of ALL_BUTTONS) {
        if (this.protocolHeld.has(button)) {
          emulator.pressButton(button);
        } else {
          emulator.releaseButton(button);
        }
      }
      return;
    }

    for (const button of ALL_BUTTONS) {
      if (this.isLegacyHeld(button, now)) {
        emulator.pressButton(button);
      } else {
        emulator.releaseButton(button);
        this.legacyHeld.delete(button);
      }
    }
  }

  private finishHandshake(): void {
    if (this.handshakeDone) {
      return;
    }

    this.handshakeDone = true;
    if (this.handshakeTimer !== undefined) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    }
    this.usesProtocol = this.gotProtocolFlags && protocolSupported(this.handshakeFlags);
    this.handshakeResolve?.();
    this.handshakeResolve = undefined;

    for (const event of this.pendingEvents) {
      this.handleEvent(event);
    }
    this.pendingEvents.length = 0;
  }

  private onData = (chunk: Buffer): void => {
    for (const event of this.parser.feed(chunk.toString("utf8"))) {
      if (event.kind === "quit" && event.type !== "release") {
        this.onQuit();
        return;
      }

      if (!this.handshakeDone) {
        if (event.kind === "protocolFlags") {
          this.gotProtocolFlags = true;
          this.handshakeFlags = event.flags;
          continue;
        }
        if (event.kind === "deviceAttributes") {
          this.finishHandshake();
          continue;
        }
        this.pendingEvents.push(event);
        continue;
      }

      this.handleEvent(event);
    }
  };

  private handleEvent(event: ParserEvent): void {
    if (event.kind !== "key") {
      return;
    }

    if (this.usesProtocol) {
      if (event.type === "release") {
        this.protocolHeld.delete(event.button);
      } else {
        this.protocolHeld.add(event.button);
      }
      return;
    }

    if (event.type === "release") {
      this.legacyHeld.delete(event.button);
      return;
    }

    const now = Date.now();
    const existing = this.legacyHeld.get(event.button);
    if (existing === undefined) {
      this.legacyHeld.set(event.button, { eventCount: 1, lastAt: now });
      return;
    }

    existing.eventCount += 1;
    existing.lastAt = now;
  }

  private isLegacyHeld(button: Button, now: number): boolean {
    const state = this.legacyHeld.get(button);
    if (state === undefined) {
      return false;
    }

    const windowMs = state.eventCount <= 1 ? INITIAL_REPEAT_MS : REPEAT_HOLD_MS;
    return now - state.lastAt < windowMs;
  }
}
