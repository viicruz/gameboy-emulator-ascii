# gameboy-emulator-ascii

Terminal Game Boy emulator. Video is drawn as braille; audio plays through PipeWire. The emulator core is [`gboy-ts`](https://github.com/viicruz/gboy.ts).

## Requirements

- [Bun](https://bun.com)
- `pw-cat` from PipeWire, for sound

If `pw-cat` is missing, playback stops and the emulator keeps running.

## Install

```bash
bun install
```

## ROMs

Put `.gb` and `.gbc` files in `roms/`. The menu only lists files in that folder. ROM files are gitignored; `roms/.gitkeep` stays in the repo.

## Run

Open the menu (render format, controls, and ROM):

```bash
bun start
```

Skip the menu and load a ROM directly:

```bash
bun start -- --rom roms/game.gb
bun start -- --rom=roms/game.gb
```

Optional flags:

| Flag | Description |
| --- | --- |
| `--format` | Render format. Default is `braille`. |
| `--width` | Frame width in columns. Also caps braille width. |
| `--rom` | Path to a `.gb` or `.gbc` file. |

Formats: `braille`, `braille-green`.

```bash
bun start -- --rom roms/game.gb --format braille-green --width 80
```

## Controls

| Button | Keys |
| --- | --- |
| D-pad | Arrow keys |
| A | `Z`, `A` |
| B | `X`, `S` |
| Select | Space |
| Start | Enter |
| Quit | `Q`, Ctrl+C |

Rebind keys from the menu. The chosen format and bindings are stored in `saves/settings.json`.

In-game input uses the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/). On start the emulator asks the terminal to disambiguate escape codes, report press, repeat, and release, and send every key as a CSI `u` sequence. It turns the protocol off on exit.

Those events are used only when the terminal reports both event types and all-keys encoding. A press or repeat holds the button, and a release clears it immediately.

Terminals that do not report press and release fall back to ordinary key repeat. A tap stays held for 350 ms, and each repeat extends the hold by 80 ms. Movement and button response feel slower and stickier in that mode. This applies to in-game controls, not the menu.

In the menu, arrow keys move the cursor, Enter confirms, and Esc goes back or quits from the home screen.

## Saves

Cartridges with battery-backed RAM write to `saves/<rom-name>.sav`.

## Tests

```bash
bun test
bun test tests/menu/menu.test.ts
```
