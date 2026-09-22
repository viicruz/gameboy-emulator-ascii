export const GB_FRAME_NS = 1_000_000_000 / 59.73;

const SPIN_NS = 1_000_000;
const MAX_LATENESS_FRAMES = 2;

export type FramePacerOptions = {
  nowNs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  spinUntil?: (deadlineNs: number) => void;
  frameNs?: number;
};

export class FramePacer {
  private readonly nowNs: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly spinUntil: (deadlineNs: number) => void;
  private readonly frameNs: number;
  private originNs = 0;
  private frameIndex = 0;
  private started = false;

  constructor(options: FramePacerOptions = {}) {
    this.nowNs = options.nowNs ?? (() => Bun.nanoseconds());
    this.sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
    this.frameNs = options.frameNs ?? GB_FRAME_NS;
    this.spinUntil =
      options.spinUntil ??
      ((deadlineNs) => {
        while (this.nowNs() < deadlineNs) {
          // Bun.sleep truncates to whole milliseconds, so the last millisecond is spun.
        }
      });
  }

  async waitForNextFrame(): Promise<void> {
    if (!this.started) {
      this.originNs = this.nowNs();
      this.frameIndex = 0;
      this.started = true;
    }

    const nextIndex = this.frameIndex + 1;
    const deadlineNs = this.originNs + nextIndex * this.frameNs;
    const nowNs = this.nowNs();

    if (nowNs - deadlineNs > this.frameNs * MAX_LATENESS_FRAMES) {
      this.originNs = nowNs;
      this.frameIndex = 0;
      return;
    }

    this.frameIndex = nextIndex;
    await this.waitUntil(deadlineNs);
  }

  private async waitUntil(deadlineNs: number): Promise<void> {
    const remainingNs = deadlineNs - this.nowNs();
    if (remainingNs <= 0) {
      return;
    }

    if (remainingNs > SPIN_NS) {
      await this.sleep((remainingNs - SPIN_NS) / 1e6);
    }

    this.spinUntil(deadlineNs);
  }
}
