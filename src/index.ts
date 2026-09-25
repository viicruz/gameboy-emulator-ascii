//* Libraries imports
import { spawn, type ChildProcess } from "node:child_process";
import type { Writable } from "node:stream";
import { Emulator } from "gboy-ts";

//* Audio imports
import { writeWithBackpressure } from "./audio/audio-writer.ts";

//* Input imports
import { JoypadInput } from "./input/input.ts";

//* Menu imports
import { parseRomArg, runMenu } from "./menu/menu.ts";

//* Render imports
import {
  centerFrame,
  fitBrailleColumns,
  LOCAL_RENDER_FORMATS,
  parseRenderArgs,
  renderFrame,
  type AppRenderFormat,
} from "./render/render.ts";

//* Save imports
import { openBatterySave, type BatterySave } from "./save/battery-save.ts";

//* Settings imports
import { readSettings, writeSettings } from "./menu/settings.ts";

//* Timing imports
import { FramePacer, GB_FRAME_NS } from "./timing/frame-pacer.ts";

const HIGHPASS_CUTOFF_HZ = 20;

const argv = process.argv.slice(2);
const settings = await readSettings();

let format: AppRenderFormat;
let width: number;
let maxWidth: number | undefined;
let controls = settings.controls;
let requestedRomPath: string | undefined;

try {
  const renderArgs = parseRenderArgs(argv, { format: settings.format, width: 80 });
  format = renderArgs.format;
  width = renderArgs.width;
  maxWidth = renderArgs.maxWidth;
  requestedRomPath = parseRomArg(argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

let cleaned = false;
let stopping = false;
let lastRenderNs = 0;
let audioEnabled = true;
let joypad: JoypadInput | undefined;
let player: ChildProcess | undefined;
let audioSink: Writable | undefined;
let batterySave: BatterySave | null | undefined;
let playerClosed = Promise.resolve();

type HighPassChannel = {
  previousInput: number;
  previousOutput: number;
};

function beginTerminalSession(): void {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(
    "\x1b[?1049h" + // alternate screen
      "\x1b[?25l" + // hide cursor
      "\x1b[?7l", // disable wrap
  );
}

function restoreTerminal(): void {
  process.stdin.setRawMode(false);
  process.stdout.write("\x1b[?25h\x1b[?1049l\x1b[?7h");
}

function cleanup(): void {
  if (cleaned) {
    return;
  }
  cleaned = true;
  joypad?.stop();
  audioSink?.end();
  player?.kill();
  restoreTerminal();
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

process.on("exit", cleanup);
process.on("SIGINT", () => {
  void shutdown();
});

let romPath: string;

if (requestedRomPath === undefined) {
  beginTerminalSession();
  const menuResult = await runMenu(format, controls);
  if (menuResult.type === "quit") {
    cleanup();
    process.exit(0);
  }
  format = menuResult.format;
  controls = menuResult.controls;
  romPath = menuResult.romPath;
} else {
  romPath = requestedRomPath;
  beginTerminalSession();
}

try {
  await writeSettings({ format, controls });
} catch (error) {
  console.error("failed to write settings:", error);
}

const rom = new Uint8Array(await Bun.file(romPath).arrayBuffer());

const emulator = new Emulator(rom);
emulator.setAudioOutputEnabled(true);

batterySave = await openBatterySave(rom, romPath, emulator);

const sampleRate = emulator.getAudioSampleRate(); // 48000
const highPassDt = 1 / sampleRate;
const highPassRc = 1 / (2 * Math.PI * HIGHPASS_CUTOFF_HZ);
const highPassAlpha = highPassRc / (highPassRc + highPassDt);

const playerProcess = spawn(
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
player = playerProcess;

playerClosed = new Promise<void>((resolve) => {
  playerProcess.once("exit", () => {
    audioEnabled = false;
    resolve();
  });
});

playerProcess.on("error", (err) => {
  audioEnabled = false;
  console.error("failed to start pw-cat:", err);
});

if (!playerProcess.stdin) {
  throw new Error("pw-cat stdin is not available");
}

playerProcess.stderr?.resume();
audioSink = playerProcess.stdin;

const framePacer = new FramePacer();
const leftChannel = createHighPassChannel();
const rightChannel = createHighPassChannel();

joypad = new JoypadInput(() => {
  void shutdown();
}, controls);

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

async function writeAudio(): Promise<void> {
  const samples = emulator.consumeAudioSamples();
  if (!audioEnabled || samples.length === 0 || audioSink === undefined) {
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
    const isBraille = (LOCAL_RENDER_FORMATS as readonly string[]).includes(format);
    const termCols = process.stdout.columns;
    const termRows = process.stdout.rows;
    const frameCols =
      isBraille && termCols !== undefined && termRows !== undefined
        ? fitBrailleColumns(termCols, termRows, maxWidth)
        : width;
    const frame = renderFrame(framebuffer, format, frameCols);
    const output = isBraille
      ? centerFrame(frame, frameCols, termCols ?? frameCols, termRows ?? frame.split("\n").length)
      : frame;
    process.stdout.write("\x1b[H" + output);
    lastRenderNs = Bun.nanoseconds() - renderStartNs;
  }

  await batterySave?.tick();
  await framePacer.waitForNextFrame();
}
