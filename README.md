# gameboy-emulator-terminal

This is a study project and a proof of concept. It is not an official product and it is not affiliated with Nintendo. It does not ship ROMs. You are responsible for using only games you have the right to use.

Terminal Game Boy emulator. Video is drawn as braille; audio plays through the system mixer. The core is [`gboy-ts`](https://github.com/viicruz/gboy.ts), a fork of [gboy.ts](https://github.com/MaxLeiter/gboy.ts). Fork details are in [docs/internals.md](docs/internals.md).

## Requirements

The installed command does not need Bun.

- Linux: `pw-cat` from PipeWire, for sound
- Windows: sound plays through `waveOut`. No extra program is required.

Running from source also needs [Bun](https://bun.com).

If the audio device cannot be opened, playback stops and the emulator keeps running.

## Install

The installer does not ship ROMs.

### Linux

```bash
curl -fsSL https://github.com/viicruz/gameboy-emulator-terminal/releases/latest/download/install.sh | bash
```

Installs the binary to `~/.local/bin/gbt`.

To install a specific version:

```bash
curl -fsSL https://github.com/viicruz/gameboy-emulator-terminal/releases/download/vX.Y.Z/install.sh | GBT_VERSION=X.Y.Z bash
```

### Windows (x64)

```powershell
irm https://github.com/viicruz/gameboy-emulator-terminal/releases/latest/download/install.ps1 | iex
```

Installs the binary to `%LOCALAPPDATA%\gbt\bin\gbt.exe` and adds that directory to the user `PATH`.

To install a specific version:

```powershell
$env:GBT_VERSION='X.Y.Z'; irm https://github.com/viicruz/gameboy-emulator-terminal/releases/download/vX.Y.Z/install.ps1 | iex
```

### From source

```bash
bun install
```

## Run

Open the menu:

```bash
gbt
```

From source:

```bash
bun start
```

Skip the menu and load a ROM directly:

```bash
gbt --rom roms/game.gb
```

From source, pass flags after `--`:

```bash
bun start -- --rom roms/game.gb
```

Flags, formats, the ROM library, controls, and saves are described in [docs/usage.md](docs/usage.md).

## Terminal support

Terminals that report key press and release hold a button until you let go. Terminals that do not fall back to ordinary key repeat. Movement and button response feel slower and stickier in that mode. This applies to in-game controls, not the menu.

In the menu, arrow keys move the cursor, Enter confirms, and Esc goes back or quits from the home screen.

## Events

A press or a repeat holds the button. A release clears it. When the terminal cannot report those events, the hold is timed instead. Protocol flags, encodings, and timings are in [docs/internals.md](docs/internals.md).
