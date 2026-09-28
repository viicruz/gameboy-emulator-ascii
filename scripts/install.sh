#!/usr/bin/env bash
set -euo pipefail

REPO="viicruz/gameboy-emulator-terminal"
INSTALL_DIR="${HOME}/.local/bin"
NAME="gbt"

os="$(uname -s)"
arch="$(uname -m)"

if [[ "${os}" != "Linux" ]]; then
  echo "Unsupported operating system: ${os}. This installer supports Linux. On Windows, use install.ps1." >&2
  exit 1
fi

case "${arch}" in
  x86_64 | amd64) cpu="x64" ;;
  aarch64 | arm64) cpu="arm64" ;;
  *)
    echo "Unsupported architecture: ${arch}." >&2
    exit 1
    ;;
esac

asset="${NAME}-linux-${cpu}"

if [[ -n "${GBT_VERSION:-}" ]]; then
  url="https://github.com/${REPO}/releases/download/v${GBT_VERSION}/${asset}"
else
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
fi

mkdir -p "${INSTALL_DIR}"
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
curl -fsSL "${url}" -o "${tmp}"
chmod +x "${tmp}"
mv "${tmp}" "${INSTALL_DIR}/${NAME}"
trap - EXIT

echo "Installed ${INSTALL_DIR}/${NAME}"
