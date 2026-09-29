//* Libraries imports
import { posix, win32 } from "node:path";

export type PathEnv = {
  platform: string;
  home: string;
  env: NodeJS.ProcessEnv;
};

export type AppPaths = {
  settingsPath: string;
  defaultRomsDirectory: string;
  savesDirectory: string;
};

export function appPaths(input: PathEnv): AppPaths {
  if (input.platform === "win32") {
    const config = envOr(input.env, "APPDATA", win32.join(input.home, "AppData", "Roaming"));
    const data = envOr(input.env, "LOCALAPPDATA", win32.join(input.home, "AppData", "Local"));
    return {
      settingsPath: win32.join(config, "gbt", "settings.json"),
      defaultRomsDirectory: win32.join(data, "gbt", "roms"),
      savesDirectory: win32.join(data, "gbt", "saves"),
    };
  }

  const config = envOr(input.env, "XDG_CONFIG_HOME", posix.join(input.home, ".config"));
  const data = envOr(input.env, "XDG_DATA_HOME", posix.join(input.home, ".local", "share"));
  return {
    settingsPath: posix.join(config, "gbt", "settings.json"),
    defaultRomsDirectory: posix.join(data, "gbt", "roms"),
    savesDirectory: posix.join(data, "gbt", "saves"),
  };
}

export function isAbsolutePath(value: string, platform: string): boolean {
  return platform === "win32" ? win32.isAbsolute(value) : posix.isAbsolute(value);
}

export function resolveRomsDirectory(
  stored: string | undefined,
  defaultRomsDirectory: string,
  platform: string,
): string {
  if (stored !== undefined && isAbsolutePath(stored, platform)) {
    return stored;
  }
  return defaultRomsDirectory;
}

export function storedRomsDirectory(chosen: string, defaultRomsDirectory: string): string | undefined {
  if (chosen === defaultRomsDirectory) {
    return undefined;
  }
  return chosen;
}

export function canOpenFolder(platform: string, env: NodeJS.ProcessEnv): boolean {
  if (platform === "win32") {
    return true;
  }
  if (platform === "linux") {
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  }
  return false;
}

export function shortenHome(directory: string, home: string): string {
  if (directory === home) {
    return "~";
  }

  const separator = directory.includes("\\") || home.includes("\\") ? "\\" : "/";
  const prefix = home.endsWith(separator) ? home : `${home}${separator}`;
  if (directory.startsWith(prefix)) {
    return `~${separator}${directory.slice(prefix.length)}`;
  }
  return directory;
}

function envOr(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  if (value === undefined || value.length === 0) {
    return fallback;
  }
  return value;
}
