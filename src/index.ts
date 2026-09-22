//* Libraries imports
import { spawn } from "node:child_process";
import { Emulator } from "gboy-ts";

//* Audio imports
import { writeWithBackpressure } from "./audio-writer.ts";

//* Input imports
import { JoypadInput } from "./input.ts";

//* Render imports
import { parseRenderArgs, renderFrame, type RenderArgs } from "./render.ts";

//* Save imports
import { openBatterySave } from "./battery-save.ts";

//* Timing imports
import { FramePacer, GB_FRAME_NS } from "./frame-pacer.ts";

const ROM_PATH = "roms/pokemon-yellow.gbc";
const HIGHPASS_CUTOFF_HZ = 20;

const rom = new Uint8Array(await Bun.file(ROM_PATH).arrayBuffer());

const emulator = new Emulator(rom);
emulator.setAudioOutputEnabled(true);

const batterySave = await openBatterySave(rom, ROM_PATH, emulator);

const sampleRate = emulator.getAudioSampleRate(); // 48000
const highPassDt = 1 / sampleRate;
const highPassRc = 1 / (2 * Math.PI * HIGHPASS_CUTOFF_HZ);
const highPassAlpha = highPassRc / (highPassRc + highPassDt);

const player = spawn(
  "pw-cat",
  [
    "--playback",
    "--rate",
    String(sampleRate),
    "--channels",
    "2",
    "--format",
    "s16",
    "--quality",
    "15",
    "--latency",
    "20ms",
    "--media-role",
    "Game",
    "-",
  ],
  { stdio: ["pipe", "ignore", "pipe"] },
);

let audioEnabled = true;

const playerClosed = new Promise<void>((resolve) => {
  player.once("exit", () => {
    audioEnabled = false;
    resolve();
  });
});

player.on("error", (err) => {
  audioEnabled = false;
  console.error("failed to start pw-cat:", err);
});

if (!player.stdin) {
  throw new Error("pw-cat stdin is not available");
}

player.stderr?.resume();

const audioSink = player.stdin;

let renderArgs: RenderArgs;
try {
  renderArgs = parseRenderArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const { format, width } = renderArgs;

let cleaned = false;
let stopping = false;
let lastRenderNs = 0;

const framePacer = new FramePacer();
const leftChannel = createHighPassChannel();
const rightChannel = createHighPassChannel();

const joypad = new JoypadInput(() => {
  void shutdown();
});

type HighPassChannel = {
  previousInput: number;
  previousOutput: number;
};

function createHighPassChannel(): HighPassChannel {
  return { previousInput: 0, previousOutput: 0 };
}

function applyHighPass(channel: HighPassChannel, input: number): number {
  const output = highPassAlpha * (channel.previousOutput + input - channel.previousInput);
  channel.previousInput = input;
  channel.previousOutput = output;
  return output;
}

function quantizeSample(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return (clamped * 32767) | 0;
}

function cleanup() {
  if (cleaned) {
    return;
  }
  cleaned = true;
  joypad.stop();
  audioSink.end();
  player.kill();
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

async function writeAudio(): Promise<void> {
  const samples = emulator.consumeAudioSamples();
  if (!audioEnabled || samples.length === 0) {
    return;
  }

  const pcm = Buffer.allocUnsafe(samples.length * 2);
  for (let frame = 0; frame < samples.length; frame += 2) {
    const left = applyHighPass(leftChannel, samples[frame]!);
    const right = applyHighPass(rightChannel, samples[frame + 1]!);
    pcm.writeInt16LE(quantizeSample(left), frame * 2);
    pcm.writeInt16LE(quantizeSample(right), (frame + 1) * 2);
  }

  try {
    await Promise.race([writeWithBackpressure(audioSink, pcm, sampleRate), playerClosed]);
  } catch (error) {
    audioEnabled = false;
    console.error("audio playback stopped:", error);
  }
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
  const frameStartNs = Bun.nanoseconds();
  joypad.apply(emulator, Date.now());
  if (stopping) {
    break;
  }
  const framebuffer = emulator.runFrame();
  await writeAudio();

  const spentNs = Bun.nanoseconds() - frameStartNs;
  const skipVisual = spentNs + lastRenderNs >= GB_FRAME_NS;
  if (!skipVisual) {
    const renderStartNs = Bun.nanoseconds();
    const frame = renderFrame(framebuffer, format, width);
    process.stdout.write("\x1b[H" + frame);
    lastRenderNs = Bun.nanoseconds() - renderStartNs;
  }

  await batterySave?.tick();
  await framePacer.waitForNextFrame();
}
