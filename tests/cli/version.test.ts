//* Libraries imports
import { describe, expect, it } from "bun:test";
import { join } from "node:path";

//* Package imports
import { version } from "../../package.json" with { type: "json" };

const projectRoot = join(import.meta.dir, "../..");

describe("gbt", () => {
  describe("--version", () => {
    it("prints the package version and exits", async () => {
      const proc = Bun.spawn(["bun", "run", "./src/index.ts", "--version"], {
        cwd: projectRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe(version);
    });
  });
});
