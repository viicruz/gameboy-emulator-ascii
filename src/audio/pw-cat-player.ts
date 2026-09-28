//* Libraries imports
import { spawn } from "node:child_process";

//* Audio imports
import type { AudioSink } from "./audio-writer.ts";
import type { AudioPlayer } from "./audio-player.ts";

export function pwCatArgs(sampleRate: number): string[] {
  return [
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
  ];
}

export function openPwCatPlayer(sampleRate: number): AudioPlayer {
  const playerProcess = spawn("pw-cat", pwCatArgs(sampleRate), {
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
