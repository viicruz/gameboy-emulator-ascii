import { Emulator, Button, renderFramebuffer } from "gboy-ts";

const rom = new Uint8Array(await Bun.file("roms/tetris.gb").arrayBuffer());

const emulator = new Emulator(rom);

const width = 100;

const FRAME_NS = 1_000_000_000 / 30;

process.stdout.write(
  "\x1b[?1049h" + // alternate screen (não mistura com o scrollback)
  "\x1b[?25l"   + // esconde o cursor
  "\x1b[?7l"      // desliga wrap (evita scroll se a linha tiver 100 cols)
);

//loop and print each frame
while (true) {

  // process.stdout.write("\x1Bc");
  // process.stdout.write("\x1b[H");
  //t0 is the start time of the frame
  const t0 = Bun.nanoseconds();
  //run the frame
  const framebuffer = emulator.runFrame();
  //render the frame and define the width, and type of rendering
  const frame = renderFramebuffer(framebuffer, "ansi-half", width);

  //concatenate the frame with the clear screen command and break line
  process.stdout.write("\x1b[H" + frame);

  //elapsed is the time taken to run the frame
  const elapsed = Bun.nanoseconds() - t0;

  //sleepTime is the time to sleep to maintain the frame rate
  const sleepTime = Math.max(0, (FRAME_NS - elapsed) / 1e6);
  await Bun.sleep(sleepTime);
  // process.stdout.write("\x1b[?25h\x1b[?1049l");
}
