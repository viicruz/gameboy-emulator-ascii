import { Emulator, Button, renderFramebuffer } from "gboy-ts";

const rom = new Uint8Array(await Bun.file("roms/tetris.gb").arrayBuffer());

const emulator = new Emulator(rom);

const width = 100;

const FRAME_NS = 1_000_000_000 / 30;

//loop and print each frame
while (true) {
  const t0 = Bun.nanoseconds();
  const framebuffer = emulator.runFrame();
  const frame = renderFramebuffer(framebuffer, "ansi-half", width);
  process.stdout.write("\x1b[H" + frame);
  const elapsed = Bun.nanoseconds() - t0;
  const sleepTime = Math.max(0, (FRAME_NS - elapsed) / 1e6);
  await Bun.sleep(sleepTime);
}
