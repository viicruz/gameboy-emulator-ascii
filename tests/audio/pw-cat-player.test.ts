//* Libraries imports
import { describe, expect, it } from "bun:test";

//* Audio imports
import { pwCatArgs, pwCatSupportsRaw } from "../../src/audio/pw-cat-player.ts";

const playbackArgs = [
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
];

describe("pwCatArgs", () => {
  it("requests 20ms stereo s16 playback at the given sample rate", () => {
    expect(pwCatArgs(48_000, false)).toEqual([...playbackArgs, "-"]);
  });

  it("requests raw samples when the installed pw-cat supports that option", () => {
    expect(pwCatArgs(48_000, true)).toEqual([...playbackArgs, "--raw", "-"]);
  });
});

describe("pwCatSupportsRaw", () => {
  it("returns false when help only lists record and remote", () => {
    const help = `
  -R, --remote                          Remote daemon name
  -r, --record                          Recording mode
`;

    expect(pwCatSupportsRaw(help)).toBe(false);
  });

  it("returns true when help lists the raw option", () => {
    const help = `
-a | --raw
: Raw samples will be read or written.
`;

    expect(pwCatSupportsRaw(help)).toBe(true);
  });
});
