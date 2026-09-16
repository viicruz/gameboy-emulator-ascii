import { Emulator, Button } from "gboy-ts";

const rom = new Uint8Array(await Bun.file("roms/tetris.gb").arrayBuffer());


const emulator = new Emulator(rom);


emulator.pressButton(Button.A);
emulator.pressButton(Button.B);
emulator.pressButton(Button.Start); 
emulator.pressButton(Button.Select);
emulator.pressButton(Button.Right);
emulator.pressButton(Button.Left);
emulator.pressButton(Button.Up);
emulator.pressButton(Button.Down);
emulator.runFrames(5);

const saved = new Uint8Array(await Bun.file("save.state").arrayBuffer());
const emulator2 = Emulator.deserialize(rom, saved);
emulator2.runFrames(1)


console.log(emulator.getFramebuffer());