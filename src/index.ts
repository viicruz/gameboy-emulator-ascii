//* Libraries imports
import { Emulator, renderFramebuffer } from "gboy-ts";

//* Input imports
import { JoypadInput } from "./input.ts";

const rom = new Uint8Array(await Bun.file("roms/pokemon-yellow.gbc").arrayBuffer());

const emulator = new Emulator(rom);

const width = 100;

const FRAME_NS = 1_000_000_000 / 59.7;

let cleaned = false;

const joypad = new JoypadInput(() => {
  cleanup();
  process.exit(0);
});

function cleanup() {
  if (cleaned) {
    return;
  }
  cleaned = true;
  joypad.stop();
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[?7h");
}

process.stdin.setRawMode(true);
process.stdin.resume();

process.stdout.write(
  "\x1b[?1049h" + // alternate screen
  "\x1b[?25l" + // hide cursor
  "\x1b[?7l", // disable wrap
);

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

await joypad.start();

while (true) {
  const t0 = Bun.nanoseconds();
  joypad.apply(emulator, Date.now());
  const framebuffer = emulator.runFrame();
  const frame = renderFramebuffer(framebuffer, "ansi-half", width);

  process.stdout.write("\x1b[H" + frame);

  const elapsed = Bun.nanoseconds() - t0;
  const sleepTime = Math.max(0, (FRAME_NS - elapsed) / 1e6);
  await Bun.sleep(sleepTime);
}
