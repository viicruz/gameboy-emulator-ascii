# Usage

## ROMs

The menu lists `.gb` and `.gbc` files from a library folder. That folder is stored as an absolute path, so it stays the same when you start `gbt` from another directory.

On first launch the library is:

- Linux: `$XDG_DATA_HOME/gbt/roms`, or `~/.local/share/gbt/roms` when `XDG_DATA_HOME` is unset
- Windows: `%LOCALAPPDATA%\gbt\roms`

Choose another folder from Library in the menu. Change opens three places: Home, the default library, and the directory where this process was started. Enter a directory, then choose `use this folder`. With a graphical session, Open folder opens the current library in the file manager (`xdg-open` on Linux when `DISPLAY` or `WAYLAND_DISPLAY` is set, `explorer` on Windows).

`--rom` loads one file and can be a relative or absolute path. The library folder, settings, and saves do not follow the directory where you run `gbt`.

ROM files in this repository are gitignored. `roms/.gitkeep` stays in the repo. From a source checkout, point Library at that `roms/` directory if you keep cartridges there.

This emulator targets the original Game Boy. Some Game Boy Color games also run on that hardware and work here. Games that require Game Boy Color hardware may fail to start or run incorrectly.

## Run

Optional flags:

| Flag | Description |
| --- | --- |
| `--format` | Render format. Default is `braille`. |
| `--width` | Frame width in columns. Also caps braille width. |
| `--rom` | Path to a `.gb` or `.gbc` file. |
| `--version` | Print the installed version and exit. |

`--rom` accepts a space or `=`:

```bash
gbt --rom roms/game.gb
gbt --rom=roms/game.gb
```

Formats: `braille`, `braille-green`.

```bash
gbt --rom roms/game.gb --format braille-green --width 80
```

From source, pass flags after `--`:

```bash
bun start -- --rom roms/game.gb
bun start -- --rom=roms/game.gb
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

Rebind keys from the menu. The chosen format, bindings, and library folder are stored in the settings file:

- Linux: `$XDG_CONFIG_HOME/gbt/settings.json`, or `~/.config/gbt/settings.json` when `XDG_CONFIG_HOME` is unset
- Windows: `%APPDATA%\gbt\settings.json`

How the terminal reports those keys is described in [internals.md](internals.md).

## Saves

Cartridges with a battery write to the saves directory:

- Linux: `$XDG_DATA_HOME/gbt/saves`, or `~/.local/share/gbt/saves` when `XDG_DATA_HOME` is unset
- Windows: `%LOCALAPPDATA%\gbt\saves`

Files are named `<rom-name>.sav`. Other cartridges do not create a file. On startup the save is loaded when its size matches cartridge RAM.

Render format, key bindings, and the library folder stay in the settings file, separate from cartridge RAM. How a save is written is described in [internals.md](internals.md).

## Tests

```bash
bun test
bun test tests/menu/menu.test.ts
```
