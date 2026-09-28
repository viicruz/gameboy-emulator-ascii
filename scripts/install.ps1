$ErrorActionPreference = "Stop"

$Repo = "viicruz/gameboy-emulator-terminal"
$Name = "gbt"
$Asset = "gbt-windows-x64.exe"
$InstallDir = Join-Path $env:LOCALAPPDATA "gbt\bin"

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
  Write-Error "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE). This installer supports Windows x64."
  exit 1
}

if ($env:GBT_VERSION) {
  $Url = "https://github.com/$Repo/releases/download/v$($env:GBT_VERSION)/$Asset"
} else {
  $Url = "https://github.com/$Repo/releases/latest/download/$Asset"
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$Dest = Join-Path $InstallDir "$Name.exe"
Invoke-WebRequest -Uri $Url -OutFile $Dest

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not $userPath) {
  $userPath = ""
}

$pathParts = @($userPath -split ";" | Where-Object { $_ -ne "" })
$alreadyPresent = $false
foreach ($part in $pathParts) {
  if ($part.TrimEnd("\") -ieq $InstallDir.TrimEnd("\")) {
    $alreadyPresent = $true
    break
  }
}

if (-not $alreadyPresent) {
  $updated = if ($userPath) { "$userPath;$InstallDir" } else { $InstallDir }
  [Environment]::SetEnvironmentVariable("Path", $updated, "User")
}

Write-Host "Installed $Dest"
