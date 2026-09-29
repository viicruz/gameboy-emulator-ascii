//* Libraries imports
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { Emulator } from "gboy-ts";

//* Package imports
import { version } from "../package.json" with { type: "json" };

//* Audio imports
import { openAudioPlayer, type AudioPlayer } from "./audio/audio-player.ts";
import { writeWithBackpressure, type AudioSink } from "./audio/audio-writer.ts";

//* Input imports
import { JoypadInput } from "./input/input.ts";

//* Menu imports
import { parseRomArg, runMenu } from "./menu/menu.ts";

//* Paths imports
import { appPaths, canOpenFolder, resolveRomsDirectory, storedRomsDirectory } from "./paths/paths.ts";

//* Render imports
import {
  centerFrame,
  fitBrailleColumns,
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

if (argv.includes("--version")) {
  console.log(version);
  process.exit(0);
}

const paths = appPaths({
  platform: process.platform,
  home: homedir(),
  env: process.env,
});

try {
  await mkdir(paths.defaultRomsDirectory, { recursive: true });
} catch (error) {
  console.error("failed to create the default rom library:", error);
}

const settings = await readSettings(paths.settingsPath);
let persistedRomsDirectory = settings.romsDirectory;
const romsDirectory = resolveRomsDirectory(
  persistedRomsDirectory,
  paths.defaultRomsDirectory,
  process.platform,
);

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
let player: AudioPlayer | undefined;
let audioSink: AudioSink | undefined;
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
  player?.close();
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
  const menuResult = await runMenu(format, controls, {
    romsDirectory,
    homeDirectory: homedir(),
    defaultRomsDirectory: paths.defaultRomsDirectory,
    launchDirectory: process.cwd(),
    canOpenFolder: canOpenFolder(process.platform, process.env),
    onLibraryChange: async (directory, snapshot) => {
      persistedRomsDirectory = storedRomsDirectory(directory, paths.defaultRomsDirectory);
      try {
        await writeSettings(
          {
            format: snapshot.format,
            controls: snapshot.controls,
            romsDirectory: persistedRomsDirectory,
          },
          paths.settingsPath,
        );
      } catch (error) {
        console.error("failed to write settings:", error);
      }
    },
  });
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
  await writeSettings({ format, controls, romsDirectory: persistedRomsDirectory }, paths.settingsPath);
} catch (error) {
  console.error("failed to write settings:", error);
}

const rom = new Uint8Array(await Bun.file(romPath).arrayBuffer());

const emulator = new Emulator(rom);
emulator.setAudioOutputEnabled(true);

batterySave = await openBatterySave(rom, romPath, emulator, { savesDir: paths.savesDirectory });

const sampleRate = emulator.getAudioSampleRate(); // 48000
const highPassDt = 1 / sampleRate;
const highPassRc = 1 / (2 * Math.PI * HIGHPASS_CUTOFF_HZ);
const highPassAlpha = highPassRc / (highPassRc + highPassDt);

const audioPlayer = openAudioPlayer(sampleRate);
player = audioPlayer;
audioSink = audioPlayer.sink;
playerClosed = audioPlayer.closed;
void audioPlayer.closed.then(() => {
  audioEnabled = false;
});

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
    if (audioPlayer.applyBackpressure) {
      await Promise.race([writeWithBackpressure(audioSink, pcm, sampleRate), playerClosed]);
    } else {
      audioSink.write(pcm);
    }
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
    const termCols = process.stdout.columns;
    const termRows = process.stdout.rows;
    const frameCols =
      termCols !== undefined && termRows !== undefined
        ? fitBrailleColumns(termCols, termRows, maxWidth)
        : width;
    const frame = renderFrame(framebuffer, format, frameCols);
    const output = centerFrame(
      frame,
      frameCols,
      termCols ?? frameCols,
      termRows ?? frame.split("\n").length,
    );
    process.stdout.write("\x1b[H" + output);
    lastRenderNs = Bun.nanoseconds() - renderStartNs;
  }

  await batterySave?.tick();
  await framePacer.waitForNextFrame();
}
