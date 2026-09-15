import { Emulator } from "gboy-ts";

const rom = new Uint8Array(await Bun.file("roms/tetris.gb").arrayBuffer());


const emulator = new Emulator(rom);

console.log(emulator.getFramebuffer());