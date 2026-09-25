//* Libraries imports
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

//* Save imports
import { openBatterySave, type BatteryRam } from "../../src/save/battery-save.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

class FakeEmulator implements BatteryRam {
  ram: Uint8Array;
  listener: (() => void) | null = null;

  constructor(length: number) {
    this.ram = new Uint8Array(length);
  }

  getRam(): Uint8Array {
    return this.ram.slice();
  }

  setRam(data: Uint8Array): void {
    if (data.length !== this.ram.length) {
      throw new Error(
        `Cartridge RAM size mismatch: expected ${this.ram.length} bytes, got ${data.length}`,
      );
    }
    this.ram.set(data);
  }

  setOnRamWrite(listener: (() => void) | null): void {
    this.listener = listener;
  }

  writeByte(value: number): void {
    const current = this.ram[0];
    if (current === undefined || current === value) {
      return;
    }
    this.ram[0] = value;
    this.listener?.();
  }
}

function makeRom(cartridgeType: number): Uint8Array {
  const rom = new Uint8Array(0x150);
  rom[0x0147] = cartridgeType;
  return rom;
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "battery-save-"));
  tempDirs.push(dir);
  return dir;
}

describe("BatterySave", () => {
  describe("openBatterySave", () => {
    it("does not read or create a save when the cartridge has no battery", async () => {
      const savesDir = await makeTempDir();
      const savePath = join(savesDir, "pokemon-yellow.sav");
      await writeFile(savePath, new Uint8Array([0x11, 0x22, 0x33, 0x44]));
      const emulator = new FakeEmulator(4);
      emulator.ram.fill(0xab);

      const save = await openBatterySave(
        makeRom(0x00),
        "roms/pokemon-yellow.gb",
        emulator,
        { savesDir },
      );

      expect(save).toBeNull();
      expect(emulator.getRam()).toEqual(new Uint8Array([0xab, 0xab, 0xab, 0xab]));
      expect(emulator.listener).toBeNull();
    });

    it("loads a save when the file length matches cartridge RAM", async () => {
      const savesDir = await makeTempDir();
      const bytes = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
      await writeFile(join(savesDir, "pokemon-yellow.sav"), bytes);
      const emulator = new FakeEmulator(4);

      const save = await openBatterySave(
        makeRom(0x1b),
        "roms/pokemon-yellow.gb",
        emulator,
        { savesDir },
      );

      expect(save).not.toBeNull();
      expect(emulator.getRam()).toEqual(bytes);
    });

    it("leaves RAM unchanged when the save length does not match", async () => {
      const savesDir = await makeTempDir();
      await writeFile(join(savesDir, "pokemon-yellow.sav"), new Uint8Array([0x01]));
      const emulator = new FakeEmulator(4);
      const errors: unknown[][] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };

      try {
        const save = await openBatterySave(
          makeRom(0x1b),
          "roms/pokemon-yellow.gb",
          emulator,
          { savesDir },
        );

        expect(save).not.toBeNull();
        expect(emulator.getRam()).toEqual(new Uint8Array(4));
        expect(errors.length).toBe(1);
      } finally {
        console.error = originalError;
      }
    });
  });

  describe("tick", () => {
    it("writes the save only after the debounce elapses", async () => {
      const savesDir = await makeTempDir();
      const savePath = join(savesDir, "pokemon-yellow.sav");
      const emulator = new FakeEmulator(4);
      let now = 5_000;
      const save = await openBatterySave(
        makeRom(0x1b),
        "roms/pokemon-yellow.gb",
        emulator,
        { savesDir, debounceMs: 1000, now: () => now },
      );
      if (save === null) {
        throw new Error("expected a battery save");
      }

      emulator.writeByte(0x7e);
      await save.tick();
      expect(await Bun.file(savePath).exists()).toBe(false);

      now += 999;
      await save.tick();
      expect(await Bun.file(savePath).exists()).toBe(false);

      now += 1;
      await save.tick();
      expect(new Uint8Array(await Bun.file(savePath).arrayBuffer())).toEqual(
        Uint8Array.from(emulator.getRam()),
      );
    });
  });

  describe("flush", () => {
    it("writes the current RAM when the save is dirty", async () => {
      const savesDir = await makeTempDir();
      const savePath = join(savesDir, "pokemon-yellow.sav");
      const emulator = new FakeEmulator(4);
      const save = await openBatterySave(
        makeRom(0x1b),
        "roms/pokemon-yellow.gb",
        emulator,
        { savesDir },
      );
      if (save === null) {
        throw new Error("expected a battery save");
      }

      await save.flush();
      expect(await Bun.file(savePath).exists()).toBe(false);

      emulator.writeByte(0x42);
      await save.flush();
      expect(new Uint8Array(await Bun.file(savePath).arrayBuffer())).toEqual(
        Uint8Array.from(emulator.getRam()),
      );
    });
  });
});
