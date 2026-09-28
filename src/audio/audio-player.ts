//* Audio imports
import { openPwCatPlayer } from "./pw-cat-player.ts";
import { openWaveOutPlayer } from "./wave-out-player.ts";
import type { AudioSink } from "./audio-writer.ts";

export type AudioPlayer = {
  sink: AudioSink | undefined;
  applyBackpressure: boolean;
  close(): void;
  closed: Promise<void>;
};

export function openAudioPlayer(sampleRate: number): AudioPlayer {
  if (process.platform === "win32") {
    return openWaveOutPlayer(sampleRate);
  }
  if (process.platform === "linux") {
    return openPwCatPlayer(sampleRate);
  }

  console.error(`audio is not supported on ${process.platform}`);
  return unavailableAudioPlayer();
}

function unavailableAudioPlayer(): AudioPlayer {
  return {
    sink: undefined,
    applyBackpressure: false,
    close() {},
    closed: Promise.resolve(),
  };
}
