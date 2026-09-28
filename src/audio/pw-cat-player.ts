//* Libraries imports
import { execFileSync, spawn } from "node:child_process";

//* Audio imports
import type { AudioSink } from "./audio-writer.ts";
import type { AudioPlayer } from "./audio-player.ts";

export function pwCatSupportsRaw(help: string): boolean {
  return help.includes("--raw");
}

export function pwCatArgs(sampleRate: number, raw: boolean): string[] {
  const args = [
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
  ];

  if (raw) {
    args.push("--raw");
  }

  args.push("-");
  return args;
}

let rawSupported: boolean | undefined;

function readPwCatHelp(): string {
  try {
    return execFileSync("pw-cat", ["--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return `${readExecOutput(error, "stdout")}${readExecOutput(error, "stderr")}`;
  }
}

function readExecOutput(error: unknown, field: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null || !(field in error)) {
    return "";
  }

  const value = (error as { stdout?: unknown; stderr?: unknown })[field];
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return "";
}

function cachedPwCatSupportsRaw(): boolean {
  if (rawSupported === undefined) {
    rawSupported = pwCatSupportsRaw(readPwCatHelp());
  }
  return rawSupported;
}

export function openPwCatPlayer(sampleRate: number): AudioPlayer {
  const playerProcess = spawn("pw-cat", pwCatArgs(sampleRate, cachedPwCatSupportsRaw()), {
    stdio: ["pipe", "ignore", "pipe"],
  });

  let resolveClosed = (): void => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  let finished = false;
  function finish(): void {
    if (finished) {
      return;
    }
    finished = true;
    resolveClosed();
  }

  playerProcess.once("exit", () => {
    finish();
  });

  playerProcess.on("error", (error) => {
    console.error("failed to start pw-cat:", error);
    finish();
  });

  playerProcess.stderr?.resume();

  const stdin = playerProcess.stdin;
  if (stdin === null) {
    throw new Error("pw-cat stdin is not available");
  }

  stdin.on("error", (error) => {
    console.error("audio playback stopped:", error);
    finish();
  });

  const sink: AudioSink = {
    get writableLength() {
      return stdin.writableLength;
    },
    get writableNeedDrain() {
      return stdin.writableNeedDrain;
    },
    write(chunk: Uint8Array): boolean {
      return stdin.write(chunk);
    },
    once(event: "drain", listener: () => void): void {
      stdin.once(event, listener);
    },
  };

  return {
    sink,
    applyBackpressure: true,
    closed,
    close() {
      if (!stdin.destroyed) {
        stdin.end();
      }
      if (playerProcess.exitCode === null) {
        playerProcess.kill();
      }
      finish();
    },
  };
}
