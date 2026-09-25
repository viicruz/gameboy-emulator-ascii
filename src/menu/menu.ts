//* Libraries imports
import { readdir } from "node:fs/promises";

//* Controls imports
import {
  assignBinding,
  cloneControls,
  DEFAULT_CONTROLS,
  formatBindings,
  GAME_BUTTONS,
  type Controls,
  type GameButton,
  type KeyBinding,
} from "../input/controls.ts";

//* Render imports
import {
  GBOY_RENDER_FORMATS,
  LOCAL_RENDER_FORMATS,
  type AppRenderFormat,
} from "../render/render.ts";

const ROMS_DIRECTORY = "roms";
const ESCAPE_TIMEOUT_MS = 25;

const MENU_RENDER_FORMATS = [...GBOY_RENDER_FORMATS, ...LOCAL_RENDER_FORMATS] as const;

const HOME_ROWS = ["render", "controls", "rom"] as const;

const BUTTON_LABEL: Record<GameButton, string> = {
  a: "A",
  b: "B",
  select: "SELECT",
  start: "START",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
};

const ARROW_FROM_FINAL: Record<string, KeyBinding> = {
  A: { kind: "arrow", direction: "up" },
  B: { kind: "arrow", direction: "down" },
  C: { kind: "arrow", direction: "right" },
  D: { kind: "arrow", direction: "left" },
};

export type MenuAction = "up" | "down" | "confirm" | "back";

export type MenuBindingKey = { type: "binding"; binding: KeyBinding } | { type: "reserved" };

export type MenuKey = MenuAction | "quit" | MenuBindingKey;

type MenuMode = "navigate" | "capture";

export type MenuState =
  | { screen: "home"; cursor: number; format: AppRenderFormat; controls: Controls }
  | { screen: "render"; cursor: number; format: AppRenderFormat; controls: Controls }
  | { screen: "rom"; cursor: number; format: AppRenderFormat; controls: Controls; roms: string[] }
  | { screen: "controls"; cursor: number; format: AppRenderFormat; controls: Controls }
  | {
      screen: "capture";
      cursor: number;
      format: AppRenderFormat;
      controls: Controls;
      button: GameButton;
      notice?: string;
    };

export type MenuStep =
  | { type: "continue"; state: MenuState }
  | { type: "quit" }
  | { type: "start"; format: AppRenderFormat; controls: Controls; romPath: string };

export type MenuResult =
  | { type: "quit" }
  | { type: "start"; format: AppRenderFormat; controls: Controls; romPath: string };

export function createHomeState(
  format: AppRenderFormat,
  controls: Controls = DEFAULT_CONTROLS,
): MenuState {
  return { screen: "home", cursor: 0, format, controls };
}

export function listRomFiles(names: readonly string[]): string[] {
  return names
    .filter((name) => isRomFileName(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function reduceMenu(
  state: MenuState,
  action: MenuAction | MenuBindingKey,
  romFiles: readonly string[] = [],
): MenuStep {
  if (typeof action !== "string") {
    return reduceCapture(state, action);
  }

  if (action === "up" || action === "down") {
    if (state.screen === "capture") {
      return { type: "continue", state };
    }
    return { type: "continue", state: moveCursor(state, action === "up" ? -1 : 1) };
  }

  if (action === "back") {
    return backFrom(state);
  }

  if (state.screen === "home") {
    return openHomeRow(state, romFiles);
  }

  if (state.screen === "render") {
    const format = MENU_RENDER_FORMATS[state.cursor];
    if (format === undefined) {
      return { type: "continue", state };
    }
    return {
      type: "continue",
      state: { screen: "home", cursor: 0, format, controls: state.controls },
    };
  }

  if (state.screen === "controls") {
    return confirmControls(state);
  }

  if (state.screen === "capture") {
    return { type: "continue", state };
  }

  const name = state.roms[state.cursor];
  if (name === undefined || !isRomFileName(name)) {
    return { type: "continue", state };
  }

  return {
    type: "start",
    format: state.format,
    controls: state.controls,
    romPath: `${ROMS_DIRECTORY}/${name}`,
  };
}

export function renderMenu(state: MenuState): string {
  if (state.screen === "home") {
    return [
      row(state.cursor === 0, `RENDER  ${state.format}`),
      row(state.cursor === 1, "CONTROLS"),
      row(state.cursor === 2, "ROM"),
      "",
      "enter  open    esc  quit",
    ].join("\n");
  }

  if (state.screen === "controls") {
    return [
      "CONTROLS",
      "",
      ...GAME_BUTTONS.map((button, index) =>
        row(index === state.cursor, `${BUTTON_LABEL[button]}  ${formatBindings(state.controls[button])}`),
      ),
      row(state.cursor === GAME_BUTTONS.length, "RESET"),
      "",
      "enter  rebind   esc  back",
    ].join("\n");
  }

  if (state.screen === "capture") {
    return [
      `REBIND ${BUTTON_LABEL[state.button]}`,
      "",
      state.notice ?? "press a key",
      "",
      "esc  cancel",
    ].join("\n");
  }

  if (state.screen === "render") {
    return [
      "RENDER",
      "",
      ...MENU_RENDER_FORMATS.map((format, index) => row(index === state.cursor, format)),
      "",
      "enter  choose   esc  back",
    ].join("\n");
  }

  if (state.roms.length === 0) {
    return ["ROM", "", "no roms in roms/", "", "esc  back"].join("\n");
  }

  return [
    "ROM",
    "",
    ...state.roms.map((name, index) => row(index === state.cursor, name)),
    "",
    "enter  start    esc  back",
  ].join("\n");
}

export function parseRomArg(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg !== "--rom" && !arg.startsWith("--rom=")) {
      continue;
    }

    const value = readFlagValue(argv, index, "--rom");
    if (value.length === 0) {
      throw new Error("Missing value for --rom.");
    }
    return value;
  }

  return undefined;
}

export async function readRomDirectory(directory = ROMS_DIRECTORY): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    return listRomFiles(names);
  } catch {
    return [];
  }
}

export class MenuKeyParser {
  private buffer = "";
  private mode: MenuMode = "navigate";
  private escapeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onDelayed: (keys: MenuKey[]) => void;

  constructor(onDelayed: (keys: MenuKey[]) => void = () => {}) {
    this.onDelayed = onDelayed;
  }

  setMode(mode: MenuMode): void {
    this.mode = mode;
  }

  feed(chunk: string): MenuKey[] {
    this.buffer += chunk;
    this.clearEscapeTimer();
    return this.consume();
  }

  flush(): MenuKey[] {
    this.clearEscapeTimer();
    if (this.buffer !== "\x1b") {
      return this.consume();
    }

    this.buffer = "";
    return ["back"];
  }

  stop(): void {
    this.clearEscapeTimer();
  }

  private consume(): MenuKey[] {
    const keys: MenuKey[] = [];

    while (this.buffer.length > 0) {
      const head = this.buffer[0]!;
      if (head !== "\x1b") {
        this.buffer = this.buffer.slice(1);
        const key = this.plainKey(head);
        if (key !== null) {
          keys.push(key);
        }
        if ((head === "\r" || head === "\n") && this.buffer[0] === "\n" && head === "\r") {
          this.buffer = this.buffer.slice(1);
        }
        continue;
      }

      if (this.buffer.length === 1) {
        this.armEscapeTimer();
        break;
      }

      const kind = this.buffer[1]!;
      if (kind !== "[" && kind !== "O") {
        this.buffer = this.buffer.slice(1);
        keys.push("back");
        continue;
      }

      if (this.buffer.length < 3) {
        break;
      }

      const finalByte = this.buffer[2]!;
      this.buffer = this.buffer.slice(3);
      const arrow = ARROW_FROM_FINAL[finalByte];
      if (this.mode === "capture" && arrow !== undefined) {
        keys.push({ type: "binding", binding: arrow });
      } else if (finalByte === "A") {
        keys.push("up");
      } else if (finalByte === "B") {
        keys.push("down");
      }
    }

    return keys;
  }

  private plainKey(head: string): MenuKey | null {
    if (head === "\x03") {
      return "quit";
    }
    if (this.mode === "capture") {
      return capturePlainKey(head);
    }
    if (head === "\r" || head === "\n") {
      return "confirm";
    }
    return null;
  }

  private armEscapeTimer(): void {
    if (this.escapeTimer !== undefined) {
      return;
    }

    this.escapeTimer = setTimeout(() => {
      this.escapeTimer = undefined;
      if (this.buffer !== "\x1b") {
        return;
      }
      this.buffer = "";
      this.onDelayed(["back"]);
    }, ESCAPE_TIMEOUT_MS);
  }

  private clearEscapeTimer(): void {
    if (this.escapeTimer === undefined) {
      return;
    }
    clearTimeout(this.escapeTimer);
    this.escapeTimer = undefined;
  }
}

export async function runMenu(
  initialFormat: AppRenderFormat,
  initialControls: Controls = DEFAULT_CONTROLS,
): Promise<MenuResult> {
  let state = createHomeState(initialFormat, initialControls);
  let settled = false;
  let pumping = false;
  const queue: MenuKey[] = [];

  const draw = (): void => {
    const frame = renderMenu(state)
      .split("\n")
      .map((line) => `${line}\x1b[K`)
      .join("\n");
    process.stdout.write(`\x1b[H${frame}\x1b[J`);
  };

  return await new Promise<MenuResult>((resolve) => {
    const finish = (result: MenuResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      parser.stop();
      process.stdin.off("data", onData);
      resolve(result);
    };

    const pump = async (): Promise<void> => {
      if (pumping) {
        return;
      }
      pumping = true;

      while (queue.length > 0 && !settled) {
        const key = queue.shift()!;
        if (key === "quit") {
          finish({ type: "quit" });
          break;
        }

        const romFiles =
          key === "confirm" && state.screen === "home" && state.cursor === 2
            ? await readRomDirectory()
            : undefined;
        if (settled) {
          break;
        }

        const step = reduceMenu(state, key, romFiles);
        if (step.type === "quit" || step.type === "start") {
          finish(step);
          break;
        }

        state = step.state;
        parser.setMode(state.screen === "capture" ? "capture" : "navigate");
        draw();
      }

      pumping = false;
      if (!settled && queue.length > 0) {
        void pump();
      }
    };

    const enqueue = (keys: MenuKey[]): void => {
      if (settled || keys.length === 0) {
        return;
      }
      queue.push(...keys);
      void pump();
    };

    const parser = new MenuKeyParser(enqueue);
    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      enqueue(parser.feed(text));
    };

    process.stdin.on("data", onData);
    draw();
  });
}

function moveCursor(state: MenuState, delta: number): MenuState {
  const length = cursorLength(state);
  return { ...state, cursor: wrapCursor(state.cursor, delta, length) };
}

function cursorLength(state: MenuState): number {
  if (state.screen === "home") {
    return HOME_ROWS.length;
  }
  if (state.screen === "render") {
    return MENU_RENDER_FORMATS.length;
  }
  if (state.screen === "controls") {
    return GAME_BUTTONS.length + 1;
  }
  if (state.screen === "capture") {
    return 1;
  }
  return state.roms.length;
}

function backFrom(state: MenuState): MenuStep {
  if (state.screen === "home") {
    return { type: "quit" };
  }
  if (state.screen === "capture") {
    return {
      type: "continue",
      state: {
        screen: "controls",
        cursor: state.cursor,
        format: state.format,
        controls: state.controls,
      },
    };
  }

  const cursor = state.screen === "rom" ? 2 : state.screen === "controls" ? 1 : 0;
  return {
    type: "continue",
    state: {
      screen: "home",
      cursor,
      format: state.format,
      controls: state.controls,
    },
  };
}

function openHomeRow(state: MenuState & { screen: "home" }, romFiles: readonly string[]): MenuStep {
  if (state.cursor === 0) {
    const cursor = MENU_RENDER_FORMATS.indexOf(state.format);
    return {
      type: "continue",
      state: {
        screen: "render",
        cursor: cursor === -1 ? 0 : cursor,
        format: state.format,
        controls: state.controls,
      },
    };
  }

  if (state.cursor === 1) {
    return {
      type: "continue",
      state: {
        screen: "controls",
        cursor: 0,
        format: state.format,
        controls: state.controls,
      },
    };
  }

  return {
    type: "continue",
    state: {
      screen: "rom",
      cursor: 0,
      format: state.format,
      controls: state.controls,
      roms: listRomFiles(romFiles),
    },
  };
}

function confirmControls(state: MenuState & { screen: "controls" }): MenuStep {
  if (state.cursor === GAME_BUTTONS.length) {
    return {
      type: "continue",
      state: { ...state, controls: cloneControls(DEFAULT_CONTROLS) },
    };
  }

  const button = GAME_BUTTONS[state.cursor];
  if (button === undefined) {
    return { type: "continue", state };
  }

  return {
    type: "continue",
    state: {
      screen: "capture",
      cursor: state.cursor,
      format: state.format,
      controls: state.controls,
      button,
    },
  };
}

function reduceCapture(state: MenuState, action: MenuBindingKey): MenuStep {
  if (state.screen !== "capture") {
    return { type: "continue", state };
  }
  if (action.type === "reserved") {
    return { type: "continue", state: { ...state, notice: "q is reserved" } };
  }

  return {
    type: "continue",
    state: {
      screen: "controls",
      cursor: state.cursor,
      format: state.format,
      controls: assignBinding(state.controls, state.button, action.binding),
    },
  };
}

function capturePlainKey(head: string): MenuKey | null {
  if (head === "q" || head === "Q") {
    return { type: "reserved" };
  }
  if (head === "\r" || head === "\n") {
    return { type: "binding", binding: { kind: "named", name: "enter" } };
  }
  if (head === " ") {
    return { type: "binding", binding: { kind: "named", name: "space" } };
  }

  const code = head.codePointAt(0) ?? 0;
  if (code < 32 || code === 127) {
    return null;
  }

  const value = head.toLowerCase();
  if ([...value].length !== 1) {
    return null;
  }
  return { type: "binding", binding: { kind: "char", value } };
}

function wrapCursor(cursor: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (cursor + delta + length) % length;
}

const SELECTED_ROW_ON = "\x1b[38;2;155;188;15m";
const SELECTED_ROW_OFF = "\x1b[0m";

function row(selected: boolean, label: string): string {
  const text = `${selected ? ">" : " "} ${label}`;
  if (!selected) {
    return text;
  }
  return `${SELECTED_ROW_ON}${text}${SELECTED_ROW_OFF}`;
}

function isRomFileName(name: string): boolean {
  if (name.length === 0 || name.includes("/") || name.includes("\\")) {
    return false;
  }
  const lower = name.toLowerCase();
  return lower.endsWith(".gb") || lower.endsWith(".gbc");
}

function readFlagValue(argv: string[], index: number, flag: string): string {
  const current = argv[index]!;
  if (current.startsWith(`${flag}=`)) {
    return current.slice(flag.length + 1);
  }

  const next = argv[index + 1];
  if (next === undefined) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return next;
}
