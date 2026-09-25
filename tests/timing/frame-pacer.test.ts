//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Timing imports
import { FramePacer, GB_FRAME_NS } from "../../src/timing/frame-pacer.ts";

function createClock() {
  let nowNs = 0;
  let sleepCount = 0;

  const pacer = new FramePacer({
    nowNs: () => nowNs,
    sleep: async (milliseconds) => {
      sleepCount += 1;
      nowNs += milliseconds * 1_000_000;
    },
    spinUntil: (deadlineNs) => {
      nowNs = Math.max(nowNs, deadlineNs);
    },
  });

  return {
    pacer,
    elapsedNs: () => nowNs,
    advanceNs: (deltaNs: number) => {
      nowNs += deltaNs;
    },
    sleepCount: () => sleepCount,
  };
}

describe("FramePacer", () => {
  describe("waitForNextFrame", () => {
    it("keeps 30 paced frames at Game Boy speed", async () => {
      const clock = createClock();

      for (let frame = 0; frame < 30; frame++) {
        await clock.pacer.waitForNextFrame();
      }

      expect(clock.elapsedNs()).toBe(30 * GB_FRAME_NS);
    });

    it("resyncs the origin when the loop falls more than two frames behind", async () => {
      const clock = createClock();

      await clock.pacer.waitForNextFrame();
      clock.advanceNs(GB_FRAME_NS * 4);
      const stalledAtNs = clock.elapsedNs();
      const sleepsBeforeStall = clock.sleepCount();

      await clock.pacer.waitForNextFrame();

      expect(clock.elapsedNs()).toBe(stalledAtNs);
      expect(clock.sleepCount()).toBe(sleepsBeforeStall);

      await clock.pacer.waitForNextFrame();

      expect(clock.elapsedNs()).toBe(stalledAtNs + GB_FRAME_NS);
    });
  });
});
