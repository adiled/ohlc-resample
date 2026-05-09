#!/usr/bin/env sh
# Install the `ohlc` CLI on macOS or Linux.
#
# Usage:
#   curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh
#   curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh -s -- --bin-dir /usr/local/bin
#
# The script downloads a self-contained binary for your platform from the
# latest GitHub Release. No Node.js required.
#
# Flags:
#   --version <vX.Y.Z>  Pin a specific release tag (default: latest).
#   --bin-dir <path>    Install destination (default: $HOME/.local/bin).

set -eu

REPO="adiled/ohlc-resample"
BIN_NAME="ohlc"
BIN_DIR="${HOME}/.local/bin"
VERSION="latest"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    -h|--help)
      cat <<'USAGE'
Install the ohlc CLI (no Node.js required).

  curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh

Flags:
  --version <vX.Y.Z>  Pin a specific release tag (default: latest)
  --bin-dir <path>    Install destination (default: $HOME/.local/bin)
USAGE
      exit 0
      ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 1 ;;
  esac
done

# Detect platform
case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux)  os=linux ;;
  *) printf 'unsupported OS: %s\nFor Windows, download from https://github.com/%s/releases\n' "$(uname -s)" "$REPO" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) printf 'unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

asset="${BIN_NAME}-${os}-${arch}"

# Resolve version → tag
if [ "$VERSION" = "latest" ]; then
  tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
        | sed -n 's/.*"tag_name": "\([^"]*\)".*/\1/p' | head -1)
  if [ -z "$tag" ]; then
    printf 'failed to resolve latest release tag\n' >&2
    exit 1
  fi
else
  tag="$VERSION"
fi

url="https://github.com/${REPO}/releases/download/${tag}/${asset}"

printf '→ Downloading %s %s for %s/%s\n' "$BIN_NAME" "$tag" "$os" "$arch"

mkdir -p "$BIN_DIR"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! curl -fSL --progress-bar -o "$tmp" "$url"; then
  printf '\nfailed to download %s\nIf the release for %s does not include a %s asset, file an issue: https://github.com/%s/issues\n' "$url" "$tag" "$asset" "$REPO" >&2
  exit 1
fi

dest="${BIN_DIR}/${BIN_NAME}"
mv "$tmp" "$dest"
chmod +x "$dest"
trap - EXIT

printf '✓ Installed %s to %s\n' "$BIN_NAME" "$dest"

# PATH hint
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '\nNote: %s is not on your PATH.\nAdd this to your shell rc:\n  export PATH="%s:$PATH"\n' "$BIN_DIR" "$BIN_DIR"
    ;;
esac

# Sanity check
if [ -x "$dest" ]; then
  ver="$("$dest" --version 2>/dev/null || true)"
  [ -n "$ver" ] && printf '\n%s --version → %s\n' "$BIN_NAME" "$ver"
fi
