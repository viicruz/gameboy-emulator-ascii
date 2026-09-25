export const GAME_BUTTONS = ["a", "b", "select", "start", "up", "down", "left", "right"] as const;

export type GameButton = (typeof GAME_BUTTONS)[number];

export type ArrowDirection = "up" | "down" | "left" | "right";

export type NamedKey = "space" | "enter";

export type KeyBinding =
  | { kind: "char"; value: string }
  | { kind: "arrow"; direction: ArrowDirection }
  | { kind: "named"; name: NamedKey };

export type Controls = Record<GameButton, KeyBinding[]>;

export type ControlLookup = {
  codepoint: Map<number, GameButton>;
  legacy: Map<string, GameButton>;
  arrow: Map<string, GameButton>;
};

const ARROW_DIRECTIONS: readonly ArrowDirection[] = ["up", "down", "left", "right"];
const NAMED_KEYS: readonly NamedKey[] = ["space", "enter"];

const ARROW_FINAL: Record<ArrowDirection, string> = {
  up: "A",
  down: "B",
  right: "C",
  left: "D",
};

export const DEFAULT_CONTROLS: Controls = {
  a: [
    { kind: "char", value: "z" },
    { kind: "char", value: "a" },
  ],
  b: [
    { kind: "char", value: "x" },
    { kind: "char", value: "s" },
  ],
  select: [{ kind: "named", name: "space" }],
  start: [{ kind: "named", name: "enter" }],
  up: [{ kind: "arrow", direction: "up" }],
  down: [{ kind: "arrow", direction: "down" }],
  left: [{ kind: "arrow", direction: "left" }],
  right: [{ kind: "arrow", direction: "right" }],
};

export function cloneControls(controls: Controls): Controls {
  return {
    a: controls.a.map(cloneBinding),
    b: controls.b.map(cloneBinding),
    select: controls.select.map(cloneBinding),
    start: controls.start.map(cloneBinding),
    up: controls.up.map(cloneBinding),
    down: controls.down.map(cloneBinding),
    left: controls.left.map(cloneBinding),
    right: controls.right.map(cloneBinding),
  };
}

export function parseControls(raw: unknown): Controls {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return cloneControls(DEFAULT_CONTROLS);
  }

  const source = raw as Record<string, unknown>;
  const controls = cloneControls(DEFAULT_CONTROLS);

  for (const button of GAME_BUTTONS) {
    if (!Object.hasOwn(source, button) || !Array.isArray(source[button])) {
      continue;
    }

    const bindings: KeyBinding[] = [];
    for (const entry of source[button]) {
      const binding = parseBinding(entry);
      if (binding === null || isReservedBinding(binding)) {
        continue;
      }
      const key = bindingKey(binding);
      if (bindings.some((item) => bindingKey(item) === key)) {
        continue;
      }
      bindings.push(binding);
    }
    controls[button] = bindings;
  }

  const seen = new Set<string>();
  for (const button of GAME_BUTTONS) {
    controls[button] = controls[button].filter((binding) => {
      const key = bindingKey(binding);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  return controls;
}

export function assignBinding(
  controls: Controls,
  button: GameButton,
  binding: KeyBinding,
): Controls {
  if (isReservedBinding(binding)) {
    return cloneControls(controls);
  }

  const next = cloneControls(controls);
  const key = bindingKey(binding);
  for (const name of GAME_BUTTONS) {
    next[name] = next[name].filter((entry) => bindingKey(entry) !== key);
  }
  next[button] = [cloneBinding(binding)];
  return next;
}

export function isReservedBinding(binding: KeyBinding): boolean {
  return binding.kind === "char" && (binding.value === "q" || binding.value === "\u0003");
}

export function bindingLabel(binding: KeyBinding): string {
  if (binding.kind === "char") {
    return binding.value;
  }
  if (binding.kind === "arrow") {
    return binding.direction;
  }
  return binding.name;
}

export function formatBindings(bindings: readonly KeyBinding[]): string {
  if (bindings.length === 0) {
    return "unbound";
  }
  return bindings.map(bindingLabel).join(", ");
}

export function buildControlLookup(controls: Controls): ControlLookup {
  const lookup: ControlLookup = {
    codepoint: new Map(),
    legacy: new Map(),
    arrow: new Map(),
  };

  for (const button of GAME_BUTTONS) {
    for (const binding of controls[button]) {
      addBinding(lookup, button, binding);
    }
  }

  return lookup;
}

function addBinding(lookup: ControlLookup, button: GameButton, binding: KeyBinding): void {
  if (binding.kind === "char") {
    const value = binding.value;
    setCodepoint(lookup, value.codePointAt(0), button);
    setLegacy(lookup, value, button);
    const upper = value.toUpperCase();
    if (upper !== value && upper.length === 1) {
      setCodepoint(lookup, upper.codePointAt(0), button);
      setLegacy(lookup, upper, button);
    }
    return;
  }

  if (binding.kind === "arrow") {
    const final = ARROW_FINAL[binding.direction];
    if (!lookup.arrow.has(final)) {
      lookup.arrow.set(final, button);
    }
    return;
  }

  if (binding.name === "space") {
    setCodepoint(lookup, 32, button);
    setLegacy(lookup, " ", button);
    return;
  }

  setCodepoint(lookup, 13, button);
  setLegacy(lookup, "\r", button);
  setLegacy(lookup, "\n", button);
}

function setCodepoint(
  lookup: ControlLookup,
  codepoint: number | undefined,
  button: GameButton,
): void {
  if (codepoint === undefined || lookup.codepoint.has(codepoint)) {
    return;
  }
  lookup.codepoint.set(codepoint, button);
}

function setLegacy(lookup: ControlLookup, char: string, button: GameButton): void {
  if (!lookup.legacy.has(char)) {
    lookup.legacy.set(char, button);
  }
}

function parseBinding(raw: unknown): KeyBinding | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const entry = raw as { kind?: unknown; value?: unknown; direction?: unknown; name?: unknown };
  if (entry.kind === "char" && typeof entry.value === "string") {
    return parseCharBinding(entry.value);
  }
  if (entry.kind === "arrow" && isArrowDirection(entry.direction)) {
    return { kind: "arrow", direction: entry.direction };
  }
  if (entry.kind === "named" && isNamedKey(entry.name)) {
    return { kind: "named", name: entry.name };
  }
  return null;
}

function parseCharBinding(value: string): KeyBinding | null {
  if ([...value].length !== 1) {
    return null;
  }
  const code = value.codePointAt(0) ?? 0;
  if (code < 32 || code === 127) {
    return null;
  }
  const normalized = value.toLowerCase();
  if ([...normalized].length !== 1) {
    return null;
  }
  return { kind: "char", value: normalized };
}

function isArrowDirection(value: unknown): value is ArrowDirection {
  return typeof value === "string" && (ARROW_DIRECTIONS as readonly string[]).includes(value);
}

function isNamedKey(value: unknown): value is NamedKey {
  return typeof value === "string" && (NAMED_KEYS as readonly string[]).includes(value);
}

function bindingKey(binding: KeyBinding): string {
  if (binding.kind === "char") {
    return `char:${binding.value}`;
  }
  if (binding.kind === "arrow") {
    return `arrow:${binding.direction}`;
  }
  return `named:${binding.name}`;
}

function cloneBinding(binding: KeyBinding): KeyBinding {
  if (binding.kind === "char") {
    return { kind: "char", value: binding.value };
  }
  if (binding.kind === "arrow") {
    return { kind: "arrow", direction: binding.direction };
  }
  return { kind: "named", name: binding.name };
}
