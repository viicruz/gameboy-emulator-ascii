//* Libraries imports
import { spawn } from "node:child_process";
import { Emulator, renderFramebuffer } from "gboy-ts";

//* Input imports
import { JoypadInput } from "./input.ts";

const rom = new Uint8Array(await Bun.file("roms/pokemon-yellow.gbc").arrayBuffer());

const emulator = new Emulator(rom);
emulator.setAudioOutputEnabled(true);

const sampleRate = emulator.getAudioSampleRate(); // 48000

const aplay = spawn(
  "aplay",
  ["-t", "raw", "-f", "S16_LE", "-c", "2", "-r", String(sampleRate), "-"],
  { stdio: ["pipe", "inherit", "inherit"] },
);

aplay.on("error", (err) => {
  console.error("failed to start aplay:", err);
});

if (!aplay.stdin) {
  throw new Error("aplay stdin is not available");
}

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
  aplay.stdin?.end();
  aplay.kill();
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[?7h");
}

function writeAudio() {
  const samples = emulator.consumeAudioSamples();
  if (samples.length === 0 || !aplay.stdin) return;

  const pcm = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    pcm.writeInt16LE((s * 32767) | 0, i * 2);
  }
  aplay.stdin.write(pcm);
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
  writeAudio();
  const frame = renderFramebuffer(framebuffer, "ansi-half", width);

  process.stdout.write("\x1b[H" + frame);

  const elapsed = Bun.nanoseconds() - t0;
  const sleepTime = Math.max(0, (FRAME_NS - elapsed) / 1e6);
  await Bun.sleep(sleepTime);
}
