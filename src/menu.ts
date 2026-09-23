//* Libraries imports
import { readdir } from "node:fs/promises";

//* Render imports
import {
  GBOY_RENDER_FORMATS,
  LOCAL_RENDER_FORMATS,
  type AppRenderFormat,
} from "./render.ts";

const ROMS_DIRECTORY = "roms";
const ESCAPE_TIMEOUT_MS = 25;

const MENU_RENDER_FORMATS = [...GBOY_RENDER_FORMATS, ...LOCAL_RENDER_FORMATS] as const;

const HOME_ROWS = ["render", "rom"] as const;

export type MenuAction = "up" | "down" | "confirm" | "back";

export type MenuKey = MenuAction | "quit";

export type MenuState =
  | { screen: "home"; cursor: number; format: AppRenderFormat }
  | { screen: "render"; cursor: number; format: AppRenderFormat }
  | { screen: "rom"; cursor: number; format: AppRenderFormat; roms: string[] };

export type MenuStep =
  | { type: "continue"; state: MenuState }
  | { type: "quit" }
  | { type: "start"; format: AppRenderFormat; romPath: string };

export type MenuResult = { type: "quit" } | { type: "start"; format: AppRenderFormat; romPath: string };

export function createHomeState(format: AppRenderFormat): MenuState {
  return { screen: "home", cursor: 0, format };
}

export function listRomFiles(names: readonly string[]): string[] {
  return names
    .filter((name) => isRomFileName(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function reduceMenu(
  state: MenuState,
  action: MenuAction,
  romFiles: readonly string[] = [],
): MenuStep {
  if (action === "up" || action === "down") {
    return { type: "continue", state: moveCursor(state, action === "up" ? -1 : 1) };
  }

  if (action === "back") {
    if (state.screen === "home") {
      return { type: "quit" };
    }
    return {
      type: "continue",
      state: {
        screen: "home",
        cursor: state.screen === "rom" ? 1 : 0,
        format: state.format,
      },
    };
  }

  if (state.screen === "home") {
    if (state.cursor === 0) {
      const cursor = MENU_RENDER_FORMATS.indexOf(state.format);
      return {
        type: "continue",
        state: {
          screen: "render",
          cursor: cursor === -1 ? 0 : cursor,
          format: state.format,
        },
      };
    }

    return {
      type: "continue",
      state: {
        screen: "rom",
        cursor: 0,
        format: state.format,
        roms: listRomFiles(romFiles),
      },
    };
  }

  if (state.screen === "render") {
    const format = MENU_RENDER_FORMATS[state.cursor];
    if (format === undefined) {
      return { type: "continue", state };
    }
    return {
      type: "continue",
      state: { screen: "home", cursor: 0, format },
    };
  }

  const name = state.roms[state.cursor];
  if (name === undefined || !isRomFileName(name)) {
    return { type: "continue", state };
  }

  return { type: "start", format: state.format, romPath: `${ROMS_DIRECTORY}/${name}` };
}

export function renderMenu(state: MenuState): string {
  if (state.screen === "home") {
    return [
      row(state.cursor === 0, `RENDER  ${state.format}`),
      row(state.cursor === 1, "ROM"),
      "",
      "enter  open    esc  quit",
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
  private escapeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onDelayed: (keys: MenuKey[]) => void;

  constructor(onDelayed: (keys: MenuKey[]) => void = () => {}) {
    this.onDelayed = onDelayed;
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
        if (head === "\r") {
          keys.push("confirm");
          if (this.buffer[0] === "\n") {
            this.buffer = this.buffer.slice(1);
          }
        } else if (head === "\n") {
          keys.push("confirm");
        } else if (head === "\x03") {
          keys.push("quit");
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
      if (finalByte === "A") {
        keys.push("up");
      } else if (finalByte === "B") {
        keys.push("down");
      }
    }

    return keys;
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

export async function runMenu(initialFormat: AppRenderFormat): Promise<MenuResult> {
  let state = createHomeState(initialFormat);
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
          key === "confirm" && state.screen === "home" && state.cursor === 1
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
  return state.roms.length;
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
