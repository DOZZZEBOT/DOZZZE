#!/usr/bin/env sh
# DOZZZE installer — clones the repo, installs deps, builds, and symlinks `dozzze` to PATH.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DOZZZEBOT/DOZZZE/main/scripts/install.sh | sh
#
# Environment variables:
#   DOZZZE_PREFIX    Install root (default: $HOME/.dozzze)
#   DOZZZE_REF       Git ref to install (default: main)
#   DOZZZE_BIN_DIR   Where to symlink `dozzze` (default: $HOME/.local/bin)
#
# This script fails fast on any step. It will NOT silently partial-install.

set -eu

# ---- Colors / logging --------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_DIM='\033[2m'
  C_GREEN='\033[32m'
  C_RED='\033[31m'
  C_YELLOW='\033[33m'
  C_RESET='\033[0m'
else
  C_DIM='' C_GREEN='' C_RED='' C_YELLOW='' C_RESET=''
fi

info()  { printf '%s▸%s %s\n' "$C_DIM" "$C_RESET" "$*"; }
ok()    { printf '%s●%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail()  { printf '%s×%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ---- Pre-flight --------------------------------------------------------------
command -v git  >/dev/null 2>&1 || fail "git is required. Install git and re-run."
command -v node >/dev/null 2>&1 || fail "node.js (>=22) is required. Install from nodejs.org and re-run."
command -v npm  >/dev/null 2>&1 || fail "npm is required (ships with node)."

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "node.js >= 22 required, found $(node -v)."
fi

DOZZZE_PREFIX="${DOZZZE_PREFIX:-$HOME/.dozzze}"
DOZZZE_REF="${DOZZZE_REF:-main}"
DOZZZE_BIN_DIR="${DOZZZE_BIN_DIR:-$HOME/.local/bin}"
SRC_DIR="$DOZZZE_PREFIX/src"

info "install prefix:  $DOZZZE_PREFIX"
info "git ref:         $DOZZZE_REF"
info "bin dir:         $DOZZZE_BIN_DIR"

# ---- Fetch source ------------------------------------------------------------
mkdir -p "$DOZZZE_PREFIX" "$DOZZZE_BIN_DIR"
if [ -d "$SRC_DIR/.git" ]; then
  info "updating existing clone at $SRC_DIR"
  git -C "$SRC_DIR" fetch --depth 1 origin "$DOZZZE_REF"
  git -C "$SRC_DIR" checkout -f "$DOZZZE_REF"
  git -C "$SRC_DIR" reset --hard "origin/$DOZZZE_REF"
else
  info "cloning DOZZZE into $SRC_DIR"
  git clone --depth 1 --branch "$DOZZZE_REF" https://github.com/DOZZZEBOT/DOZZZE.git "$SRC_DIR"
fi

# ---- Build -------------------------------------------------------------------
info "installing dependencies (this can take a minute)"
( cd "$SRC_DIR" && npm install --silent )

info "building node package"
( cd "$SRC_DIR" && npm run build --workspaces --if-present --silent )

# ---- Link --------------------------------------------------------------------
BIN_SRC="$SRC_DIR/packages/node/dist/cli.js"
[ -f "$BIN_SRC" ] || fail "build artefact missing: $BIN_SRC"
chmod +x "$BIN_SRC" 2>/dev/null || true

BIN_DEST="$DOZZZE_BIN_DIR/dozzze"
if [ -e "$BIN_DEST" ] || [ -L "$BIN_DEST" ]; then
  rm -f "$BIN_DEST"
fi

# Prefer a shell shim over a direct symlink: survives `node` location changes and
# plays nice on systems where the symlinked file's shebang is not honored.
cat > "$BIN_DEST" <<EOF
#!/usr/bin/env sh
exec node "$BIN_SRC" "\$@"
EOF
chmod +x "$BIN_DEST"

ok "installed. try:  $BIN_DEST --version"

case ":$PATH:" in
  *":$DOZZZE_BIN_DIR:"*) ;;
  *)
    warn "$DOZZZE_BIN_DIR is not in your PATH."
    warn "add this to your shell rc:  export PATH=\"$DOZZZE_BIN_DIR:\$PATH\""
    ;;
esac

ok "next steps:"
echo "    dozzze doctor           # sanity-check your environment"
echo "    dozzze wallet create    # create a devnet wallet"
echo "    dozzze start            # light it up"
