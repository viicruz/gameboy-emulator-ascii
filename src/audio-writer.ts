export type AudioSink = {
  writableLength: number;
  writableNeedDrain?: boolean;
  write(chunk: Uint8Array): boolean;
  once(event: "drain", listener: () => void): void;
};

export function queuedBytesLimit(sampleRate: number): number {
  return sampleRate * 0.02 * 2 * 2;
}

export async function writeWithBackpressure(
  sink: AudioSink,
  pcm: Uint8Array,
  sampleRate: number,
): Promise<void> {
  const limit = queuedBytesLimit(sampleRate);

  while (sink.writableLength > limit) {
    if (sink.writableNeedDrain === false) {
      await wait(1);
      continue;
    }
    await waitForDrain(sink);
  }

  if (!sink.write(pcm)) {
    await waitForDrain(sink);
  }
}

function waitForDrain(sink: AudioSink): Promise<void> {
  return new Promise((resolve) => {
    sink.once("drain", () => {
      resolve();
    });
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
