//* Libraries imports
import { spawn } from "node:child_process";
import { Emulator } from "gboy-ts";

//* Input imports
import { JoypadInput } from "./input.ts";

//* Render imports
import { parseRenderArgs, renderFrame, type RenderArgs } from "./render.ts";

//* Save imports
import { openBatterySave } from "./battery-save.ts";

const ROM_PATH = "roms/pokemon-yellow.gbc";

const rom = new Uint8Array(await Bun.file(ROM_PATH).arrayBuffer());

const emulator = new Emulator(rom);
emulator.setAudioOutputEnabled(true);

const batterySave = await openBatterySave(rom, ROM_PATH, emulator);

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

let renderArgs: RenderArgs;
try {
  renderArgs = parseRenderArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { format, width } = renderArgs;

const FRAME_NS = 1_000_000_000 / 59.7;

let cleaned = false;
let stopping = false;

const joypad = new JoypadInput(() => {
  void shutdown();
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

async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  try {
    await batterySave?.flush();
  } catch (error) {
    console.error("failed to flush battery save:", error);
  }
  cleanup();
  process.exit(0);
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
  void shutdown();
});

await joypad.start();

while (!stopping) {
  const t0 = Bun.nanoseconds();
  joypad.apply(emulator, Date.now());
  if (stopping) {
    break;
  }
  const framebuffer = emulator.runFrame();
  writeAudio();
  const frame = renderFrame(framebuffer, format, width);

  process.stdout.write("\x1b[H" + frame);
  await batterySave?.tick();

  const elapsed = Bun.nanoseconds() - t0;
  const sleepTime = Math.max(0, (FRAME_NS - elapsed) / 1e6);
  await Bun.sleep(sleepTime);
}
