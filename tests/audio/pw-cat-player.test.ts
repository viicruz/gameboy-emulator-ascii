//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Audio imports
import { pwCatArgs } from "../../src/audio/pw-cat-player.ts";

describe("pwCatArgs", () => {
  it("requests 20ms stereo s16 playback at the given sample rate", () => {
    expect(pwCatArgs(48_000)).toEqual([
      "--playback",
      "--rate",
      "48000",
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
    ]);
  });
});
