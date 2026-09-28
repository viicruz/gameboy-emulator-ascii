//* Libraries imports
import { dlopen, FFIType, ptr } from "bun:ffi";

//* Audio imports
import type { AudioSink } from "./audio-writer.ts";
import type { AudioPlayer } from "./audio-player.ts";

// x64 and arm64 WAVEHDR. lpData is a pointer, so dwBufferLength sits at byte 8
// and dwFlags at byte 24. sizeof(WAVEHDR) is 48.
export const WAVEHDR_BYTES = 48;
export const WAVEHDR_BUFFER_LENGTH_OFFSET = 8;
export const WAVEHDR_FLAGS_OFFSET = 24;
export const WHDR_DONE = 0x00000001;
export const WAVE_OUT_SLOT_COUNT = 4;
export const SLOT_WAIT_NS = 20_000_000;

const DRAIN_POLL_MS = 2;
const PRIME_BUFFER_COUNT = 2;
const WAVE_FORMAT_PCM = 1;
const WAVE_MAPPER = 0xffffffff;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = (CHANNELS * BITS_PER_SAMPLE) / 8;

export type WaveOutBinding = {
  prepare(header: Uint8Array): void;
  write(header: Uint8Array): void;
  unprepare(header: Uint8Array): void;
  restart(): void;
  reset(): void;
  close(): void;
};

export type WaveOutPlayerOptions = {
  nowNs?: () => number;
};

type Slot = {
  header: Buffer;
  data: Buffer;
  inUse: boolean;
  prepared: boolean;
};

export function encodeWaveFormat(sampleRate: number): Buffer {
  const format = Buffer.alloc(18);
  format.writeUInt16LE(WAVE_FORMAT_PCM, 0);
  format.writeUInt16LE(CHANNELS, 2);
  format.writeUInt32LE(sampleRate, 4);
  format.writeUInt32LE(sampleRate * BLOCK_ALIGN, 8);
  format.writeUInt16LE(BLOCK_ALIGN, 12);
  format.writeUInt16LE(BITS_PER_SAMPLE, 14);
  format.writeUInt16LE(0, 16);
  return format;
}

export function openWaveOutPlayer(sampleRate: number): AudioPlayer {
  try {
    return createWaveOutPlayer(openWinmm(sampleRate));
  } catch (error) {
    console.error("failed to start waveOut:", error);
    return {
      sink: undefined,
      applyBackpressure: false,
      close() {},
      closed: Promise.resolve(),
    };
  }
}

export function createWaveOutPlayer(binding: WaveOutBinding, options: WaveOutPlayerOptions = {}): AudioPlayer {
  const nowNs = options.nowNs ?? (() => Bun.nanoseconds());
  const slots = Array.from({ length: WAVE_OUT_SLOT_COUNT }, () => createSlot());
  let resolveClosed = (): void => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let isClosed = false;
  let playbackStarted = false;
  let drainListener: (() => void) | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;

  function stopDrainTimer(): void {
    if (drainTimer === undefined) {
      return;
    }
    clearTimeout(drainTimer);
    drainTimer = undefined;
  }

  function emitDrain(): void {
    const listener = drainListener;
    drainListener = undefined;
    stopDrainTimer();
    listener?.();
  }

  function hasFreeSlot(): boolean {
    return slots.some((slot) => !slot.inUse);
  }

  function takeFreeSlot(): Slot | undefined {
    reap();
    return slots.find((slot) => !slot.inUse);
  }

  function waitForFreeSlot(): Slot | undefined {
    const deadlineNs = nowNs() + SLOT_WAIT_NS;
    while (nowNs() < deadlineNs) {
      const slot = takeFreeSlot();
      if (slot !== undefined) {
        return slot;
      }
    }
    return undefined;
  }

  function reap(): void {
    if (isClosed) {
      return;
    }
    for (const slot of slots) {
      if (!slot.inUse) {
        continue;
      }
      const flags = slot.header.readUInt32LE(WAVEHDR_FLAGS_OFFSET);
      if ((flags & WHDR_DONE) === 0) {
        continue;
      }
      binding.unprepare(slot.header);
      slot.header.writeUInt32LE(0, WAVEHDR_FLAGS_OFFSET);
      slot.prepared = false;
      slot.inUse = false;
    }
  }

  function scheduleDrain(): void {
    if (isClosed || drainTimer !== undefined || drainListener === undefined) {
      return;
    }
    drainTimer = setTimeout(() => {
      drainTimer = undefined;
      reap();
      if (drainListener === undefined) {
        return;
      }
      if (hasFreeSlot()) {
        emitDrain();
        return;
      }
      scheduleDrain();
    }, DRAIN_POLL_MS);
  }

  function queuedBytes(): number {
    let total = 0;
    for (const slot of slots) {
      if (slot.inUse) {
        total += slot.header.readUInt32LE(WAVEHDR_BUFFER_LENGTH_OFFSET);
      }
    }
    return total;
  }

  function queue(slot: Slot, chunk: Uint8Array): void {
    if (slot.data.length < chunk.length) {
      slot.data = Buffer.alloc(chunk.length);
    }
    slot.data.set(chunk, 0);
    writeHeader(slot, chunk.length);
    binding.prepare(slot.header);
    slot.prepared = true;
    try {
      binding.write(slot.header);
    } catch (error) {
      try {
        binding.unprepare(slot.header);
      } catch (unprepareError) {
        console.error("waveOutUnprepareHeader failed:", unprepareError);
      }
      slot.prepared = false;
      throw error;
    }
    slot.inUse = true;
    if (!playbackStarted && slots.filter((queued) => queued.inUse).length >= PRIME_BUFFER_COUNT) {
      binding.restart();
      playbackStarted = true;
    }
  }

  const sink: AudioSink = {
    get writableLength() {
      reap();
      return queuedBytes();
    },
    get writableNeedDrain() {
      reap();
      return !hasFreeSlot();
    },
    write(chunk: Uint8Array): boolean {
      if (isClosed) {
        return false;
      }
      if (chunk.length === 0) {
        return true;
      }
      const slot = takeFreeSlot() ?? waitForFreeSlot();
      if (slot === undefined) {
        return true;
      }
      queue(slot, chunk);
      return true;
    },
    once(_event: "drain", listener: () => void): void {
      if (isClosed) {
        queueMicrotask(listener);
        return;
      }
      drainListener = listener;
      scheduleDrain();
    },
  };

  return {
    sink,
    applyBackpressure: false,
    closed,
    close() {
      if (isClosed) {
        return;
      }
      isClosed = true;
      stopDrainTimer();
      try {
        binding.reset();
      } catch (error) {
        console.error("waveOutReset failed:", error);
      }
      for (const slot of slots) {
        if (!slot.prepared) {
          continue;
        }
        try {
          binding.unprepare(slot.header);
        } catch (error) {
          console.error("waveOutUnprepareHeader failed:", error);
        }
        slot.prepared = false;
        slot.inUse = false;
      }
      try {
        binding.close();
      } catch (error) {
        console.error("waveOutClose failed:", error);
      }
      emitDrain();
      resolveClosed();
    },
  };
}

function createSlot(): Slot {
  return {
    header: Buffer.alloc(WAVEHDR_BYTES),
    data: Buffer.alloc(0),
    inUse: false,
    prepared: false,
  };
}

function writeHeader(slot: Slot, byteLength: number): void {
  const header = slot.header;
  header.writeBigUInt64LE(BigInt(ptr(slot.data)), 0);
  header.writeUInt32LE(byteLength, WAVEHDR_BUFFER_LENGTH_OFFSET);
  header.writeUInt32LE(0, 12);
  header.writeBigUInt64LE(0n, 16);
  header.writeUInt32LE(0, WAVEHDR_FLAGS_OFFSET);
  header.writeUInt32LE(0, 28);
  header.writeBigUInt64LE(0n, 32);
  header.writeBigUInt64LE(0n, 40);
}

function openWinmm(sampleRate: number): WaveOutBinding {
  const format = encodeWaveFormat(sampleRate);
  const handleBuf = Buffer.alloc(8);
  const lib = dlopen("winmm.dll", {
    waveOutOpen: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u32],
      returns: FFIType.u32,
    },
    waveOutPrepareHeader: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.u32,
    },
    waveOutWrite: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.u32,
    },
    waveOutUnprepareHeader: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
      returns: FFIType.u32,
    },
    waveOutReset: {
      args: [FFIType.ptr],
      returns: FFIType.u32,
    },
    waveOutPause: {
      args: [FFIType.ptr],
      returns: FFIType.u32,
    },
    waveOutRestart: {
      args: [FFIType.ptr],
      returns: FFIType.u32,
    },
    waveOutClose: {
      args: [FFIType.ptr],
      returns: FFIType.u32,
    },
  });

  const opened = lib.symbols.waveOutOpen(ptr(handleBuf), WAVE_MAPPER, ptr(format), 0n, 0n, 0);
  if (opened !== 0) {
    lib.close();
    throw new Error(`waveOutOpen failed: ${opened}`);
  }

  const handle = handleBuf.readBigUInt64LE(0);
  const paused = lib.symbols.waveOutPause(handle) === 0;
  // Kept for the life of the device so the format block passed to waveOutOpen stays allocated.
  const state = { format, handle, lib, paused };

  return {
    prepare(header: Uint8Array): void {
      check(state.lib.symbols.waveOutPrepareHeader(state.handle, ptr(header), WAVEHDR_BYTES), "waveOutPrepareHeader");
    },
    write(header: Uint8Array): void {
      check(state.lib.symbols.waveOutWrite(state.handle, ptr(header), WAVEHDR_BYTES), "waveOutWrite");
    },
    unprepare(header: Uint8Array): void {
      check(
        state.lib.symbols.waveOutUnprepareHeader(state.handle, ptr(header), WAVEHDR_BYTES),
        "waveOutUnprepareHeader",
      );
    },
    restart(): void {
      if (!state.paused) {
        return;
      }
      check(state.lib.symbols.waveOutRestart(state.handle), "waveOutRestart");
      state.paused = false;
    },
    reset(): void {
      check(state.lib.symbols.waveOutReset(state.handle), "waveOutReset");
    },
    close(): void {
      check(state.lib.symbols.waveOutClose(state.handle), "waveOutClose");
      state.lib.close();
    },
  };
}

function check(status: number, name: string): void {
  if (status !== 0) {
    throw new Error(`${name} failed: ${status}`);
  }
}
