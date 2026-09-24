//* Libraries imports
import { describe, expect, it } from "bun:test";
import { APU } from "gboy-ts";

const CPU_CLOCK_HZ = 4_194_304;
const NR21 = 0xff16;
const NR22 = 0xff17;
const NR23 = 0xff18;
const NR24 = 0xff19;
const NR50 = 0xff24;
const NR51 = 0xff25;

const SILENCE_PEAK_TO_PEAK = 0.005;
const SILENCE_WINDOW_FRAMES = 64;

function peakToPeak(samples: Float32Array, startFrame: number): number {
  let min = Infinity;
  let max = -Infinity;

  for (let frame = 0; frame < SILENCE_WINDOW_FRAMES; frame++) {
    const sample = samples[(startFrame + frame) * 2]!;
    if (sample < min) min = sample;
    if (sample > max) max = sample;
  }

  return max - min;
}

function millisecondsUntilSilence(samples: Float32Array, sampleRate: number): number {
  const frameCount = samples.length / 2;

  for (let start = 0; start + SILENCE_WINDOW_FRAMES <= frameCount; start++) {
    if (peakToPeak(samples, start) < SILENCE_PEAK_TO_PEAK) {
      return (start / sampleRate) * 1000;
    }
  }

  throw new Error("square channel never reached silence");
}

describe("APU", () => {
  describe("frame sequencer envelope", () => {
    it("fades a period-1 decreasing envelope in about 234 ms", () => {
      const apu = new APU();
      apu.setOutputEnabled(true);
      apu.writeRegister(NR50, 0x77);
      apu.writeRegister(NR51, 0x22);
      apu.writeRegister(NR21, 0x80);
      apu.writeRegister(NR22, 0xf1);
      apu.writeRegister(NR23, 0x00);
      apu.writeRegister(NR24, 0x87);

      const durationCycles = Math.floor(CPU_CLOCK_HZ * 0.5);
      const collected: number[] = [];
      for (let cycles = 0; cycles < durationCycles; cycles += 200) {
        apu.tick(200);
        const chunk = apu.consumeSamples();
        for (let index = 0; index < chunk.length; index++) {
          collected.push(chunk[index]!);
        }
      }

      const samples = Float32Array.from(collected);
      const silenceMs = millisecondsUntilSilence(samples, apu.getSampleRate());

      expect(peakToPeak(samples, 0)).toBeGreaterThan(SILENCE_PEAK_TO_PEAK);
      expect(silenceMs).toBeGreaterThan(220);
      expect(silenceMs).toBeLessThan(250);
    });
  });
});
