# Internals

## Emulator core

The core is [`gboy-ts`](https://github.com/viicruz/gboy.ts), a fork of [gboy.ts](https://github.com/MaxLeiter/gboy.ts). This project pins that fork at `github:viicruz/gboy.ts#85cea5e`.

Upstream targets the browser and serverless environments, where progress is a full savestate (`serialize` / `deserialize`): a snapshot of the running machine. It does not write cartridge battery RAM to disk.

The fork adds `getRam`, `setRam`, and `setOnRamWrite` so a long-running process can persist that RAM. This app turns those calls into `<rom-name>.sav` in the user saves directory. See [Saves](#saves).

Upstream steps the APU frame sequencer every 512 T-cycles, so length, envelope, and sweep run sixteen times too fast. The fork sets that period to 8192 T-cycles.

## Input

In-game input uses the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/). On start the emulator asks the terminal to disambiguate escape codes, report press, repeat, and release, and send every key as a CSI `u` sequence. It turns the protocol off on exit.

Those events are used only when the terminal reports both event types and all-keys encoding. A press or repeat holds the button, and a release clears it immediately.

Terminals that do not report press and release fall back to ordinary key repeat. A tap stays held for 350 ms, and each repeat extends the hold by 80 ms. Movement and button response feel slower and stickier in that mode. This applies to in-game controls, not the menu.

## Saves

Cartridges whose type byte at `0x0147` includes a battery write a save file. The file locations are in [usage.md](usage.md#saves).

A RAM write waits 1 second, then the file is replaced atomically: write `*.sav.tmp`, then rename it over the save. Quitting flushes a pending write.
