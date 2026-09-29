//* Libraries imports
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

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

//* Paths imports
import { shortenHome } from "../paths/paths.ts";

//* Render imports
import { LOCAL_RENDER_FORMATS, type AppRenderFormat } from "../render/render.ts";

const ESCAPE_TIMEOUT_MS = 25;

const MENU_RENDER_FORMATS = LOCAL_RENDER_FORMATS;

const HOME_ROWS = ["render", "controls", "library", "rom"] as const;

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

const FALLBACK_SESSION: MenuSession = {
  defaultRomsDirectory: "/roms",
  launchDirectory: "/",
  canOpenFolder: false,
};

export type MenuAction = "up" | "down" | "confirm" | "back";

export type MenuBindingKey = { type: "binding"; binding: KeyBinding } | { type: "reserved" };

export type MenuKey = MenuAction | "quit" | MenuBindingKey;

type MenuMode = "navigate" | "capture";

type MenuCore = {
  format: AppRenderFormat;
  controls: Controls;
  romsDirectory: string;
  homeDirectory: string;
};

type LibraryContext = {
  defaultRomsDirectory: string;
  launchDirectory: string;
  canOpenFolder: boolean;
};

export type MenuState =
  | (MenuCore & { screen: "home"; cursor: number })
  | (MenuCore & { screen: "render"; cursor: number })
  | (MenuCore & { screen: "rom"; cursor: number; roms: string[] })
  | (MenuCore & { screen: "controls"; cursor: number })
  | (MenuCore & {
      screen: "capture";
      cursor: number;
      button: GameButton;
      notice?: string;
    })
  | (MenuCore & LibraryContext & { screen: "library"; cursor: number })
  | (MenuCore & LibraryContext & { screen: "places"; cursor: number })
  | (MenuCore &
      LibraryContext & { screen: "browse"; cursor: number; directory: string; entries: string[] });

export type MenuStep =
  | { type: "continue"; state: MenuState }
  | { type: "quit" }
  | { type: "start"; format: AppRenderFormat; controls: Controls; romPath: string }
  | { type: "persist-library"; romsDirectory: string; state: MenuState }
  | { type: "open-folder"; directory: string; state: MenuState };

export type MenuResult =
  | { type: "quit" }
  | { type: "start"; format: AppRenderFormat; controls: Controls; romPath: string };

export type MenuInput = {
  romFiles?: readonly string[];
  directories?: readonly string[];
};

export type MenuSession = {
  defaultRomsDirectory: string;
  launchDirectory: string;
  canOpenFolder: boolean;
};

export type LibrarySnapshot = {
  format: AppRenderFormat;
  controls: Controls;
};

export type RunMenuOptions = {
  romsDirectory: string;
  homeDirectory: string;
  defaultRomsDirectory: string;
  launchDirectory: string;
  canOpenFolder: boolean;
  onLibraryChange?: (romsDirectory: string, snapshot: LibrarySnapshot) => Promise<void>;
  openFolder?: (directory: string) => void;
};

export function createHomeState(
  format: AppRenderFormat,
  controls: Controls = DEFAULT_CONTROLS,
  romsDirectory = "/roms",
  homeDirectory = "/home/user",
): MenuState {
  return { screen: "home", cursor: 0, format, controls, romsDirectory, homeDirectory };
}

export function listRomFiles(names: readonly string[]): string[] {
  return names
    .filter((name) => isRomFileName(name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function directoryToRead(state: MenuState): string | undefined {
  if (state.screen === "places") {
    if (state.cursor === 0) {
      return state.homeDirectory;
    }
    if (state.cursor === 2) {
      return state.launchDirectory;
    }
    return undefined;
  }

  if (state.screen !== "browse") {
    return undefined;
  }

  if (state.cursor === 0) {
    return undefined;
  }

  if (state.cursor === 1) {
    const parent = dirname(state.directory);
    if (parent === state.directory) {
      return undefined;
    }
    return parent;
  }

  const name = state.entries[state.cursor - 2];
  if (name === undefined) {
    return undefined;
  }
  return join(state.directory, name);
}

export function reduceMenu(
  state: MenuState,
  action: MenuAction | MenuBindingKey,
  input: MenuInput = {},
  session: MenuSession = FALLBACK_SESSION,
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
    return openHomeRow(state, input, session);
  }

  if (state.screen === "render") {
    const format = MENU_RENDER_FORMATS[state.cursor];
    if (format === undefined) {
      return { type: "continue", state };
    }
    return {
      type: "continue",
      state: { screen: "home", cursor: 0, ...core(state), format },
    };
  }

  if (state.screen === "controls") {
    return confirmControls(state);
  }

  if (state.screen === "capture") {
    return { type: "continue", state };
  }

  if (state.screen === "library") {
    return confirmLibrary(state);
  }

  if (state.screen === "places") {
    return confirmPlaces(state, input);
  }

  if (state.screen === "browse") {
    return confirmBrowse(state, input);
  }

  const name = state.roms[state.cursor];
  if (name === undefined || !isRomFileName(name)) {
    return { type: "continue", state };
  }

  return {
    type: "start",
    format: state.format,
    controls: state.controls,
    romPath: join(state.romsDirectory, name),
  };
}

export function renderMenu(state: MenuState): string {
  if (state.screen === "home") {
    return [
      row(state.cursor === 0, `RENDER  ${state.format}`),
      row(state.cursor === 1, "CONTROLS"),
      row(state.cursor === 2, `LIBRARY  ${shortenHome(state.romsDirectory, state.homeDirectory)}`),
      row(state.cursor === 3, "ROM"),
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

  if (state.screen === "library") {
    const rows = [row(state.cursor === 0, "change")];
    if (state.canOpenFolder) {
      rows.push(row(state.cursor === 1, "open folder"));
    }
    return [
      "LIBRARY",
      "",
      shortenHome(state.romsDirectory, state.homeDirectory),
      "",
      ...rows,
      "",
      "enter  choose   esc  back",
    ].join("\n");
  }

  if (state.screen === "places") {
    return [
      "PLACES",
      "",
      row(state.cursor === 0, "Home"),
      row(state.cursor === 1, "Default library"),
      row(state.cursor === 2, shortenHome(state.launchDirectory, state.homeDirectory)),
      "",
      "enter  open    esc  back",
    ].join("\n");
  }

  if (state.screen === "browse") {
    return [
      "BROWSE",
      shortenHome(state.directory, state.homeDirectory),
      "",
      row(state.cursor === 0, "use this folder"),
      row(state.cursor === 1, ".."),
      ...state.entries.map((name, index) => row(state.cursor === index + 2, name)),
      "",
      "enter  open    esc  back",
    ].join("\n");
  }

  if (state.roms.length === 0) {
    return ["ROM", "", "no roms in this library", "", "esc  back"].join("\n");
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

export async function readRomDirectory(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const names = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    return listRomFiles(names);
  } catch {
    return [];
  }
}

export async function readSubdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
    return listDirectoryNames(names);
  } catch {
    return [];
  }
}

export function openInFileManager(directory: string, platform = process.platform): void {
  const command = platform === "win32" ? "explorer" : "xdg-open";
  try {
    const child = spawn(command, [directory], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    return;
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
  options: RunMenuOptions,
): Promise<MenuResult> {
  let state = createHomeState(
    initialFormat,
    initialControls,
    options.romsDirectory,
    options.homeDirectory,
  );
  let settled = false;
  let pumping = false;
  const queue: MenuKey[] = [];
  const session: MenuSession = {
    defaultRomsDirectory: options.defaultRomsDirectory,
    launchDirectory: options.launchDirectory,
    canOpenFolder: options.canOpenFolder,
  };
  const openFolder = options.openFolder ?? openInFileManager;

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

        const listingDirectory = key === "confirm" ? directoryToRead(state) : undefined;
        const directories =
          listingDirectory !== undefined ? await readSubdirectories(listingDirectory) : undefined;
        const romFiles =
          key === "confirm" && state.screen === "home" && HOME_ROWS[state.cursor] === "rom"
            ? await readRomDirectory(state.romsDirectory)
            : undefined;
        if (settled) {
          break;
        }

        const step = reduceMenu(state, key, { romFiles, directories }, session);
        if (step.type === "quit" || step.type === "start") {
          finish(step);
          break;
        }

        if (step.type === "persist-library") {
          await options.onLibraryChange?.(step.romsDirectory, {
            format: step.state.format,
            controls: step.state.controls,
          });
        } else if (step.type === "open-folder") {
          openFolder(step.directory);
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
  if (state.screen === "library") {
    return state.canOpenFolder ? 2 : 1;
  }
  if (state.screen === "places") {
    return 3;
  }
  if (state.screen === "browse") {
    return state.entries.length + 2;
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
        ...core(state),
      },
    };
  }
  if (state.screen === "browse") {
    return { type: "continue", state: toPlaces(state) };
  }
  if (state.screen === "places") {
    return { type: "continue", state: toLibrary(state, state.romsDirectory) };
  }
  if (state.screen === "library") {
    return {
      type: "continue",
      state: { screen: "home", cursor: homeIndex("library"), ...core(state) },
    };
  }

  const cursor =
    state.screen === "rom" ? homeIndex("rom") : state.screen === "controls" ? homeIndex("controls") : 0;
  return {
    type: "continue",
    state: {
      screen: "home",
      cursor,
      ...core(state),
    },
  };
}

function openHomeRow(
  state: MenuState & { screen: "home" },
  input: MenuInput,
  session: MenuSession,
): MenuStep {
  const rowName = HOME_ROWS[state.cursor];
  if (rowName === "render") {
    const cursor = MENU_RENDER_FORMATS.indexOf(state.format);
    return {
      type: "continue",
      state: {
        screen: "render",
        cursor: cursor === -1 ? 0 : cursor,
        ...core(state),
      },
    };
  }

  if (rowName === "controls") {
    return {
      type: "continue",
      state: {
        screen: "controls",
        cursor: 0,
        ...core(state),
      },
    };
  }

  if (rowName === "library") {
    return { type: "continue", state: libraryScreen(state, session) };
  }

  return {
    type: "continue",
    state: {
      screen: "rom",
      cursor: 0,
      ...core(state),
      roms: listRomFiles(input.romFiles ?? []),
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
      ...core(state),
      button,
    },
  };
}

function confirmLibrary(state: MenuState & { screen: "library" }): MenuStep {
  if (state.cursor === 0) {
    return { type: "continue", state: toPlaces(state) };
  }
  if (state.cursor === 1 && state.canOpenFolder) {
    return { type: "open-folder", directory: state.romsDirectory, state };
  }
  return { type: "continue", state };
}

function confirmPlaces(state: MenuState & { screen: "places" }, input: MenuInput): MenuStep {
  if (state.cursor === 1) {
    return {
      type: "persist-library",
      romsDirectory: state.defaultRomsDirectory,
      state: toLibrary(state, state.defaultRomsDirectory),
    };
  }

  const directory = state.cursor === 0 ? state.homeDirectory : state.launchDirectory;
  return { type: "continue", state: toBrowse(state, directory, input.directories ?? []) };
}

function confirmBrowse(state: MenuState & { screen: "browse" }, input: MenuInput): MenuStep {
  if (state.cursor === 0) {
    return {
      type: "persist-library",
      romsDirectory: state.directory,
      state: toLibrary(state, state.directory),
    };
  }

  const directory = directoryToRead(state);
  if (directory === undefined) {
    return { type: "continue", state };
  }
  return { type: "continue", state: toBrowse(state, directory, input.directories ?? []) };
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
      ...core(state),
      controls: assignBinding(state.controls, state.button, action.binding),
    },
  };
}

function libraryScreen(state: MenuCore, session: MenuSession): MenuState {
  return {
    screen: "library",
    cursor: 0,
    format: state.format,
    controls: state.controls,
    romsDirectory: state.romsDirectory,
    homeDirectory: state.homeDirectory,
    defaultRomsDirectory: session.defaultRomsDirectory,
    launchDirectory: session.launchDirectory,
    canOpenFolder: session.canOpenFolder,
  };
}

function toLibrary(state: MenuCore & LibraryContext, romsDirectory: string): MenuState {
  return {
    screen: "library",
    cursor: 0,
    format: state.format,
    controls: state.controls,
    romsDirectory,
    homeDirectory: state.homeDirectory,
    defaultRomsDirectory: state.defaultRomsDirectory,
    launchDirectory: state.launchDirectory,
    canOpenFolder: state.canOpenFolder,
  };
}

function toPlaces(state: MenuCore & LibraryContext): MenuState {
  return {
    screen: "places",
    cursor: 0,
    format: state.format,
    controls: state.controls,
    romsDirectory: state.romsDirectory,
    homeDirectory: state.homeDirectory,
    defaultRomsDirectory: state.defaultRomsDirectory,
    launchDirectory: state.launchDirectory,
    canOpenFolder: state.canOpenFolder,
  };
}

function toBrowse(
  state: MenuCore & LibraryContext,
  directory: string,
  entries: readonly string[],
): MenuState {
  return {
    screen: "browse",
    cursor: 0,
    format: state.format,
    controls: state.controls,
    romsDirectory: state.romsDirectory,
    homeDirectory: state.homeDirectory,
    defaultRomsDirectory: state.defaultRomsDirectory,
    launchDirectory: state.launchDirectory,
    canOpenFolder: state.canOpenFolder,
    directory,
    entries: listDirectoryNames(entries),
  };
}

function core(state: MenuState): MenuCore {
  return {
    format: state.format,
    controls: state.controls,
    romsDirectory: state.romsDirectory,
    homeDirectory: state.homeDirectory,
  };
}

function homeIndex(rowName: (typeof HOME_ROWS)[number]): number {
  return HOME_ROWS.indexOf(rowName);
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

function listDirectoryNames(names: readonly string[]): string[] {
  return names.filter((name) => isDirectoryName(name)).sort((left, right) => left.localeCompare(right, "en"));
}

function isDirectoryName(name: string): boolean {
  if (name.length === 0 || name === "." || name === "..") {
    return false;
  }
  return !name.includes("/") && !name.includes("\\");
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
