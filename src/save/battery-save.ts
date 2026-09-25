//* Libraries imports
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

const CARTRIDGE_TYPE_ADDRESS = 0x0147;
const DEBOUNCE_MS = 1000;

const BATTERY_CARTRIDGE_TYPES = new Set([
  0x03, // MBC1+RAM+BATTERY
  0x06, // MBC2+BATTERY
  0x09, // ROM+RAM+BATTERY
  0x0d, // MMM01+RAM+BATTERY
  0x0f, // MBC3+TIMER+BATTERY
  0x10, // MBC3+TIMER+RAM+BATTERY
  0x13, // MBC3+RAM+BATTERY
  0x1b, // MBC5+RAM+BATTERY
  0x1e, // MBC5+RUMBLE+RAM+BATTERY
  0x22, // MBC7+SENSOR+RUMBLE+RAM+BATTERY
  0xff, // HuC1+RAM+BATTERY
]);

export type BatteryRam = {
  getRam(): Uint8Array;
  setRam(data: Uint8Array): void;
  setOnRamWrite(listener: (() => void) | null): void;
};

export type BatterySaveOptions = {
  savesDir?: string;
  debounceMs?: number;
  now?: () => number;
};

export function romHasBattery(rom: Uint8Array): boolean {
  return BATTERY_CARTRIDGE_TYPES.has(rom[CARTRIDGE_TYPE_ADDRESS] ?? 0);
}

export function savePathForRom(romPath: string, savesDir = "saves"): string {
  const romName = basename(romPath, extname(romPath));
  return join(savesDir, `${romName}.sav`);
}

export class BatterySave {
  private dirty = false;
  private dirtyAt = 0;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly emulator: BatteryRam,
    private readonly filePath: string,
    private readonly debounceMs = DEBOUNCE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    const expected = this.emulator.getRam().length;
    if (expected === 0) {
      return;
    }

    const file = Bun.file(this.filePath);
    if (!(await file.exists())) {
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== expected) {
      console.error(
        `save size mismatch for ${this.filePath}: expected ${expected} bytes, got ${bytes.length}`,
      );
      return;
    }

    this.emulator.setRam(bytes);
  }

  attach(): void {
    this.emulator.setOnRamWrite(() => {
      this.dirty = true;
      this.dirtyAt = this.now();
    });
  }

  async tick(): Promise<void> {
    if (!this.dirty || this.writing !== null) {
      return;
    }
    if (this.now() - this.dirtyAt < this.debounceMs) {
      return;
    }
    await this.flush();
  }

  async flush(): Promise<void> {
    while (this.dirty || this.writing !== null) {
      if (this.writing !== null) {
        await this.writing;
        continue;
      }
      if (!this.dirty) {
        return;
      }

      this.dirty = false;
      const savedAt = this.dirtyAt;
      this.dirtyAt = 0;
      const bytes = this.emulator.getRam().slice();
      if (bytes.length === 0) {
        return;
      }

      const pending = this.writeAtomic(bytes).catch((error: unknown) => {
        this.dirty = true;
        if (this.dirtyAt === 0) {
          this.dirtyAt = savedAt;
        }
        throw error;
      });
      this.writing = pending.finally(() => {
        this.writing = null;
      });
      await this.writing;
    }
  }

  private async writeAtomic(bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    try {
      await writeFile(tmpPath, bytes);
      await rename(tmpPath, this.filePath);
    } catch (error) {
      await rm(tmpPath, { force: true });
      throw error;
    }
  }
}

export async function openBatterySave(
  rom: Uint8Array,
  romPath: string,
  emulator: BatteryRam,
  options: BatterySaveOptions = {},
): Promise<BatterySave | null> {
  if (!romHasBattery(rom) || emulator.getRam().length === 0) {
    return null;
  }

  const save = new BatterySave(
    emulator,
    savePathForRom(romPath, options.savesDir ?? "saves"),
    options.debounceMs ?? DEBOUNCE_MS,
    options.now ?? Date.now,
  );
  await save.load();
  save.attach();
  return save;
}
