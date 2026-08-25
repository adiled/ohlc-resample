#!/usr/bin/env sh
# Install (or uninstall) the `ohlc` CLI on macOS or Linux.
#
# Brings its own Node.js if you don't have a recent enough one already.
# Single source of truth: the npm package. No per-platform binaries.
#
# Usage:
#   curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh
#   curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh -s -- --uninstall
#
# Install flags:
#   --version <version>   Pin the npm version to install (default: latest).
#   --bin-dir <path>      Where to place the `ohlc` launcher (default: $HOME/.local/bin).
#   --install-dir <path>  Where to place runtime + lib (default: $HOME/.ohlc).
#
# Uninstall flags:
#   --uninstall           Remove the launcher and the install dir.
#   --force               Remove the directories even if they don't look like
#                         this installer wrote them.

set -eu

PKG=ohlc-resample
BIN_NAME=ohlc

MODE=install
VERSION=latest
BIN_DIR="${HOME}/.local/bin"
INSTALL_DIR="${HOME}/.ohlc"
FORCE=0

# Pinned Node version we'll fetch when the host's Node is missing or too old.
# Must satisfy the package's `engines.node`.
NODE_VERSION=26.7.0
MIN_NODE_MAJOR=26
MIN_NODE_MINOR=0

while [ $# -gt 0 ]; do
  case "$1" in
    --version)      VERSION="$2"; shift 2 ;;
    --bin-dir)      BIN_DIR="$2"; shift 2 ;;
    --install-dir)  INSTALL_DIR="$2"; shift 2 ;;
    --uninstall)    MODE=uninstall; shift ;;
    --force)        FORCE=1; shift ;;
    -h|--help)
      cat <<'USAGE'
Install (or uninstall) the ohlc CLI. Brings its own Node.js if needed.

Install:
  curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh

Uninstall:
  curl -fsSL https://github.com/adiled/ohlc-resample/raw/main/install.sh | sh -s -- --uninstall

Install flags:
  --version <version>   Pin the npm version (default: latest)
  --bin-dir <path>      Launcher destination (default: $HOME/.local/bin)
  --install-dir <path>  Runtime + lib destination (default: $HOME/.ohlc)

Uninstall flags:
  --uninstall           Switch to uninstall mode
  --force               Remove dirs even if they don't look like this installer wrote them
USAGE
      exit 0
      ;;
    *) printf 'unknown flag: %s\n' "$1" >&2; exit 1 ;;
  esac
done

# Detect platform
case "$(uname -s)" in
  Darwin) os=darwin; archive_ext=tar.gz ;;
  Linux)  os=linux;  archive_ext=tar.xz ;;
  *) printf 'unsupported OS: %s\n' "$(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64)  arch=x64 ;;
  *) printf 'unsupported architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
esac

# ---- Uninstall ----
if [ "$MODE" = "uninstall" ]; then
  launcher="${BIN_DIR}/${BIN_NAME}"
  removed_any=0

  if [ -e "$launcher" ]; then
    # Sanity check: is it our launcher? Our launcher refs the package path.
    if [ "$FORCE" -eq 1 ] || grep -q "node_modules/${PKG}/dist/cli.js" "$launcher" 2>/dev/null; then
      rm -f "$launcher"
      printf '✓ Removed launcher %s\n' "$launcher"
      removed_any=1
    else
      printf 'Refusing to remove %s (does not look like our launcher).\nPass --force to override.\n' "$launcher" >&2
    fi
  fi

  if [ -d "$INSTALL_DIR" ]; then
    # Sanity check: does it look like our install dir?
    if [ "$FORCE" -eq 1 ] || [ -d "${INSTALL_DIR}/lib/node_modules/${PKG}" ] || [ -d "${INSTALL_DIR}/runtime" ]; then
      rm -rf "$INSTALL_DIR"
      printf '✓ Removed install dir %s\n' "$INSTALL_DIR"
      removed_any=1
    else
      printf 'Refusing to remove %s (does not look like our install dir).\nPass --force to override.\n' "$INSTALL_DIR" >&2
    fi
  fi

  if [ "$removed_any" -eq 0 ]; then
    printf 'Nothing to uninstall (no launcher at %s and no install dir at %s).\n' "$launcher" "$INSTALL_DIR"
  fi
  exit 0
fi

# ---- Install ----
mkdir -p "$BIN_DIR" "$INSTALL_DIR"

# Decide which Node to use.
NODE=""
NPM=""

version_ge() {
  # version_ge "26.7.0" "26.0" → returns 0 if first ≥ MIN_NODE_MAJOR.MIN_NODE_MINOR
  v=$1
  major=$(echo "$v" | cut -d. -f1)
  minor=$(echo "$v" | cut -d. -f2)
  if [ "$major" -gt "$MIN_NODE_MAJOR" ]; then return 0; fi
  if [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; then return 0; fi
  return 1
}

if command -v node >/dev/null 2>&1; then
  host_v=$(node -p 'process.versions.node' 2>/dev/null || echo "0.0.0")
  if version_ge "$host_v"; then
    NODE=$(command -v node)
    NPM=$(command -v npm)
    printf '✓ Using host Node %s (%s)\n' "$host_v" "$NODE"
  else
    printf '→ Host Node is %s, need ≥%d.%d. Downloading a bundled Node…\n' "$host_v" "$MIN_NODE_MAJOR" "$MIN_NODE_MINOR"
  fi
fi

# Bring our own Node if the host's isn't suitable.
if [ -z "$NODE" ]; then
  url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${os}-${arch}.${archive_ext}"
  printf '→ Fetching %s\n' "$url"

  rt_dir="${INSTALL_DIR}/runtime"
  rm -rf "$rt_dir"
  mkdir -p "$rt_dir"

  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  if ! curl -fSL --progress-bar -o "$tmp" "$url"; then
    printf 'failed to download Node %s for %s/%s\n' "$NODE_VERSION" "$os" "$arch" >&2
    exit 1
  fi

  tar -xf "$tmp" -C "$rt_dir" --strip-components=1
  rm "$tmp"
  trap - EXIT

  NODE="$rt_dir/bin/node"
  NPM="$rt_dir/bin/npm"
  printf '✓ Node %s installed at %s\n' "$NODE_VERSION" "$rt_dir"
fi

# Install the package using whichever Node we picked. Extend PATH so npm's
# `#!/usr/bin/env node` shebang resolves to the chosen Node when it's bundled.
lib_dir="${INSTALL_DIR}/lib"
mkdir -p "$lib_dir"
[ -f "${lib_dir}/package.json" ] || printf '{"name":"ohlc-installer","private":true}\n' > "${lib_dir}/package.json"

if [ "$VERSION" = "latest" ]; then
  spec="$PKG"
else
  spec="${PKG}@${VERSION}"
fi

printf '→ Installing %s into %s\n' "$spec" "$lib_dir"
node_bin_dir=$(dirname "$NODE")
PATH="${node_bin_dir}:${PATH}" "$NPM" install --prefix "$lib_dir" "$spec" --silent --no-audit --no-fund --no-progress

# Write the launcher.
launcher="${BIN_DIR}/${BIN_NAME}"
cat > "$launcher" <<EOF
#!/bin/sh
exec "$NODE" "${lib_dir}/node_modules/${PKG}/dist/cli.js" "\$@"
EOF
chmod +x "$launcher"

printf '✓ Installed %s to %s\n' "$BIN_NAME" "$launcher"

# PATH hint
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    printf '\nNote: %s is not on your PATH.\nAdd this to your shell rc:\n  export PATH="%s:$PATH"\n' "$BIN_DIR" "$BIN_DIR"
    ;;
esac

# Sanity check
if [ -x "$launcher" ]; then
  v="$("$launcher" --version 2>/dev/null || true)"
  [ -n "$v" ] && printf '\n%s --version → %s\n' "$BIN_NAME" "$v"
fi
