import { Emulator, Button, renderFramebuffer } from "gboy-ts";

const rom = new Uint8Array(await Bun.file("roms/tetris.gb").arrayBuffer());

const emulator = new Emulator(rom);

const width = 100;

const FRAME_NS = 1_000_000_000 / 30;

const KEY_TO_BUTTON: Record<string, Button> = {
  "\x1b[A": Button.Up,
  "\x1b[B": Button.Down,
  "\x1b[C": Button.Right,
  "\x1b[D": Button.Left,
  z: Button.A,
  x: Button.B,
  a: Button.A,
  s: Button.B,
  Enter: Button.Start, // tratado à parte, ver parser abaixo
  " ": Button.Select,
};

const held = new Map<Button, number>(); // button → último timestamp (ms)
const HOLD_MS = 50;

function applyHeldButtons(emulator: Emulator, now: number) {
  for (const button of [
    Button.Up, Button.Down, Button.Left, Button.Right,
    Button.A, Button.B, Button.Select, Button.Start,
  ]) {
    const last = held.get(button);
    if (last !== undefined && now - last < HOLD_MS) {
      emulator.pressButton(button);
    } else {
      emulator.releaseButton(button);
      held.delete(button);
    }
  }
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (chunk: Buffer) => {
  const key = chunk.toString("utf8");

  //if key pressed are "q" or "Q" or Ctrl+C then exit the program
  if (key === "\x03" || key === "q" || key === "Q") {
    cleanup();
    process.exit(0);
  }
  const button =
    key === "\r" || key === "\n" ? Button.Start : KEY_TO_BUTTON[key];
  if (button !== undefined) {
    held.set(button, Date.now());
  }
});


process.stdout.write(
  "\x1b[?1049h" + // alternate screen (não mistura com o scrollback)
  "\x1b[?25l" + // esconde o cursor
  "\x1b[?7l"      // desliga wrap (evita scroll se a linha tiver 100 cols)
);

//loop and print each frame
while (true) {

  // process.stdout.write("\x1Bc");
  // process.stdout.write("\x1b[H");
  //t0 is the start time of the frame
  const t0 = Bun.nanoseconds();
  applyHeldButtons(emulator, Date.now());
  //run the frame
  const framebuffer = emulator.runFrame();
  //render the frame and define the width, and type of rendering
  const frame = renderFramebuffer(framebuffer, "half-blocks", width);

  //concatenate the frame with the clear screen command and break line
  process.stdout.write("\x1b[H" + frame);

  //elapsed is the time taken to run the frame
  const elapsed = Bun.nanoseconds() - t0;

  //sleepTime is the time to sleep to maintain the frame rate
  const sleepTime = Math.max(0, (FRAME_NS - elapsed) / 1e6);
  await Bun.sleep(sleepTime);
  // process.stdout.write("\x1b[?25h\x1b[?1049l");
}

function cleanup() {
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[?7h");
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});