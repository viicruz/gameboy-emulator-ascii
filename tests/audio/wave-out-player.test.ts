//* Libraries imports
import { toBuffer } from "bun:ffi";
import { describe, expect, it } from "bun:test";

//* Audio imports
import {
  createWaveOutPlayer,
  encodeWaveFormat,
  SLOT_WAIT_NS,
  WAVE_OUT_SLOT_COUNT,
  WAVEHDR_BUFFER_LENGTH_OFFSET,
  WAVEHDR_BYTES,
  WAVEHDR_FLAGS_OFFSET,
  WHDR_DONE,
  type WaveOutBinding,
} from "../../src/audio/wave-out-player.ts";

describe("encodeWaveFormat", () => {
  it("packs stereo s16 PCM at the given sample rate", () => {
    expect(encodeWaveFormat(48_000)).toEqual(
      Buffer.from([
        0x01, 0x00, 0x02, 0x00, 0x80, 0xbb, 0x00, 0x00, 0x00, 0xee, 0x02, 0x00, 0x04, 0x00, 0x10, 0x00, 0x00,
        0x00,
      ]),
    );
  });
});

describe("WAVEHDR layout", () => {
  it("places dwFlags at byte 24 of the 48-byte 64-bit header", () => {
    expect(WAVEHDR_BYTES).toBe(48);
    expect(WAVEHDR_BUFFER_LENGTH_OFFSET).toBe(8);
    expect(WAVEHDR_FLAGS_OFFSET).toBe(24);
    expect(WHDR_DONE).toBe(0x00000001);
  });
});

describe("createWaveOutPlayer", () => {
  describe("write", () => {
    it("queues pcm and reports the queued byte length", () => {
      const fake = createFakeBinding();
      const player = createWaveOutPlayer(fake.binding);
      try {
        const sink = requireSink(player.sink);
        const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);

        expect(sink.write(pcm)).toBe(true);

        expect(sink.writableLength).toBe(pcm.length);
        expect(fake.calls).toEqual(["prepare", "write"]);
        const header = fake.headers[0];
        if (header === undefined) {
          throw new Error("expected a queued header");
        }
        expect(pcmFromHeader(header)).toEqual(pcm);
      } finally {
        player.close();
      }
    });

    it("accepts pcm in every slot", () => {
      const fake = createFakeBinding();
      const player = createWaveOutPlayer(fake.binding);
      try {
        const sink = requireSink(player.sink);
        const results: boolean[] = [];
        for (let slot = 0; slot < WAVE_OUT_SLOT_COUNT; slot++) {
          results.push(sink.write(Buffer.alloc(8, slot)));
        }

        expect(player.applyBackpressure).toBe(false);
        expect(results).toEqual(Array.from({ length: WAVE_OUT_SLOT_COUNT }, () => true));
        expect(sink.writableLength).toBe(8 * WAVE_OUT_SLOT_COUNT);
      } finally {
        player.close();
      }
    });

    it("drops pcm when every slot stays busy past the spin deadline", () => {
      const fake = createFakeBinding();
      let reads = 0;
      const player = createWaveOutPlayer(fake.binding, {
        nowNs() {
          reads += 1;
          return reads === 1 ? 0 : SLOT_WAIT_NS + 1;
        },
      });
      try {
        const sink = requireSink(player.sink);
        for (let slot = 0; slot < WAVE_OUT_SLOT_COUNT; slot++) {
          sink.write(Buffer.alloc(8, slot));
        }
        const callsAfterFill = fake.calls.length;

        expect(sink.write(Buffer.alloc(8, 9))).toBe(true);

        expect(sink.writableLength).toBe(8 * WAVE_OUT_SLOT_COUNT);
        expect(fake.calls.length).toBe(callsAfterFill);
      } finally {
        player.close();
      }
    });
  });

  describe("restart", () => {
    it("starts playback once the second buffer is queued", () => {
      const fake = createFakeBinding();
      const player = createWaveOutPlayer(fake.binding);
      try {
        const sink = requireSink(player.sink);

        sink.write(Buffer.alloc(4));
        expect(fake.calls).not.toContain("restart");

        sink.write(Buffer.alloc(4));
        sink.write(Buffer.alloc(4));

        expect(fake.calls.filter((call) => call === "restart")).toEqual(["restart"]);
      } finally {
        player.close();
      }
    });
  });

  describe("when a buffer finishes", () => {
    it("releases the slot and emits drain", async () => {
      const fake = createFakeBinding();
      const player = createWaveOutPlayer(fake.binding);
      try {
        const sink = requireSink(player.sink);
        for (let slot = 0; slot < WAVE_OUT_SLOT_COUNT; slot++) {
          sink.write(Buffer.alloc(8, slot));
        }
        const drained = new Promise<void>((resolve) => {
          sink.once("drain", () => {
            resolve();
          });
        });
        const header = fake.headers[0];
        if (header === undefined) {
          throw new Error("expected a queued header");
        }
        header.writeUInt32LE(WHDR_DONE, WAVEHDR_FLAGS_OFFSET);

        await drained;

        expect(sink.writableLength).toBe(8 * (WAVE_OUT_SLOT_COUNT - 1));
        expect(fake.calls).toContain("unprepare");
      } finally {
        player.close();
      }
    });
  });

  describe("close", () => {
    it("resets, unprepares, and closes the device once", async () => {
      const fake = createFakeBinding();
      const player = createWaveOutPlayer(fake.binding);
      const sink = requireSink(player.sink);
      sink.write(Buffer.from([9, 8, 7, 6]));
      let drained = false;
      sink.once("drain", () => {
        drained = true;
      });

      player.close();
      player.close();
      await player.closed;

      expect(drained).toBe(true);
      expect(fake.calls).toEqual(["prepare", "write", "reset", "unprepare", "close"]);
    });
  });
});

function requireSink(sink: ReturnType<typeof createWaveOutPlayer>["sink"]) {
  if (sink === undefined) {
    throw new Error("expected an audio sink");
  }
  return sink;
}

function pcmFromHeader(header: Buffer): Buffer {
  const address = header.readBigUInt64LE(0);
  const length = header.readUInt32LE(WAVEHDR_BUFFER_LENGTH_OFFSET);
  return Buffer.from(toBuffer(address, 0, length));
}

type FakeBinding = {
  binding: WaveOutBinding;
  calls: string[];
  headers: Buffer[];
};

function createFakeBinding(): FakeBinding {
  const calls: string[] = [];
  const headers: Buffer[] = [];
  const binding: WaveOutBinding = {
    prepare() {
      calls.push("prepare");
    },
    write(header: Uint8Array) {
      calls.push("write");
      headers.push(Buffer.isBuffer(header) ? header : Buffer.from(header));
    },
    unprepare() {
      calls.push("unprepare");
    },
    restart() {
      calls.push("restart");
    },
    reset() {
      calls.push("reset");
    },
    close() {
      calls.push("close");
    },
  };
  return { binding, calls, headers };
}
