//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Audio imports
import { queuedBytesLimit, writeWithBackpressure, type AudioSink } from "../../src/audio/audio-writer.ts";

const SAMPLE_RATE = 48_000;

function createSink(options: {
  writableLength: number;
  writeResult?: boolean;
  onWait?: (sink: MutableSink) => void;
}): MutableSink {
  const sink: MutableSink = {
    writableLength: options.writableLength,
    writes: [],
    write(chunk: Uint8Array): boolean {
      sink.writes.push(chunk);
      return options.writeResult ?? true;
    },
    once(_event: "drain", listener: () => void): void {
      queueMicrotask(() => {
        options.onWait?.(sink);
        listener();
      });
    },
  };

  return sink;
}

type MutableSink = AudioSink & {
  writes: Uint8Array[];
};

describe("writeWithBackpressure", () => {
  describe("when the queue is empty", () => {
    it("writes the pcm buffer", async () => {
      const pcm = Buffer.from([1, 2, 3, 4]);
      const sink = createSink({ writableLength: 0 });

      await writeWithBackpressure(sink, pcm, SAMPLE_RATE);

      expect(sink.writes).toEqual([pcm]);
    });
  });

  describe("when write returns false", () => {
    it("waits for drain before resolving", async () => {
      const pcm = Buffer.from([5, 6, 7, 8]);
      const order: string[] = [];
      const sink = createSink({
        writableLength: 0,
        writeResult: false,
        onWait: () => {
          order.push("drain");
        },
      });
      const originalWrite = sink.write.bind(sink);
      sink.write = (chunk) => {
        order.push("write");
        return originalWrite(chunk);
      };

      await writeWithBackpressure(sink, pcm, SAMPLE_RATE);

      expect(order).toEqual(["write", "drain"]);
      expect(sink.writes).toEqual([pcm]);
    });
  });

  describe("when the queue is above the 20ms cap and drain is not pending", () => {
    it("waits until the queue drops before writing", async () => {
      const pcm = Buffer.from([1, 2, 3, 4]);
      let queuedBytes = queuedBytesLimit(SAMPLE_RATE) + 8;
      const writes: Uint8Array[] = [];
      const sink: AudioSink = {
        get writableLength() {
          return queuedBytes;
        },
        writableNeedDrain: false,
        write(chunk) {
          writes.push(chunk);
          return true;
        },
        once() {
          throw new Error("drain is not pending");
        },
      };

      setTimeout(() => {
        queuedBytes = 0;
      }, 0);

      await writeWithBackpressure(sink, pcm, SAMPLE_RATE);

      expect(writes).toEqual([pcm]);
    });
  });

  describe("when the queue is above the 20ms cap", () => {
    it("waits for drain before writing", async () => {
      const pcm = Buffer.from([9, 10, 11, 12]);
      const order: string[] = [];
      const sink = createSink({
        writableLength: queuedBytesLimit(SAMPLE_RATE) + 1,
        onWait: (waitingSink) => {
          order.push("drain");
          waitingSink.writableLength = 0;
        },
      });
      const originalWrite = sink.write.bind(sink);
      sink.write = (chunk) => {
        order.push("write");
        expect(sink.writableLength).toBeLessThanOrEqual(queuedBytesLimit(SAMPLE_RATE));
        return originalWrite(chunk);
      };

      await writeWithBackpressure(sink, pcm, SAMPLE_RATE);

      expect(order).toEqual(["drain", "write"]);
      expect(sink.writes).toEqual([pcm]);
    });
  });
});
