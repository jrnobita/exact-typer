#!/bin/bash
# Exact Typer installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/jrnobita/exact-typer/main/install/install-mac.sh | bash
#
# Downloads the extension into ~/Exact Typer, copies that path, and opens
# chrome://extensions. Chrome does not let any program add an extension by
# itself (outside the Chrome Web Store), so the last 3 clicks are yours.
# Running it again updates the files in place.

set -euo pipefail

REPO="jrnobita/exact-typer"
BRANCH="${EXACT_TYPER_BRANCH:-main}"
DEST="${EXACT_TYPER_DIR:-$HOME/Exact Typer}"

b=$'\033[1m'; g=$'\033[32m'; r=$'\033[31m'; d=$'\033[2m'; x=$'\033[0m'
fail() { echo "${r}${b}Install failed:${x} $1" >&2; exit 1; }

echo "${b}Installing Exact Typer...${x}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ -n "${EXACT_TYPER_SRC_ZIP:-}" ]; then
  cp "$EXACT_TYPER_SRC_ZIP" "$tmp/src.zip"
else
  curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$tmp/src.zip" \
    || fail "could not download from GitHub. Check your internet connection and try again."
fi
unzip -q "$tmp/src.zip" -d "$tmp/src" || fail "the download is damaged. Try again."
src="$(find "$tmp/src" -maxdepth 2 -type d -name extension | head -n 1)"
[ -n "$src" ] && [ -f "$src/manifest.json" ] || fail "the download does not contain the extension."

# Only ever replace a folder that holds Exact Typer (or is empty).
if [ -e "$DEST" ]; then
  [ -d "$DEST" ] || fail "\"$DEST\" exists and is not a folder. Move it away and run this again."
  if [ -n "$(ls -A "$DEST")" ] && ! grep -q '"name": "Exact Typer"' "$DEST/manifest.json" 2>/dev/null; then
    fail "\"$DEST\" already exists and is not an Exact Typer folder. Move it away and run this again."
  fi
  find "$DEST" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  updated=1
else
  mkdir -p "$DEST"
  updated=0
fi
cp -R "$src/." "$DEST/"

version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -n 1)"
printf '%s' "$DEST" | pbcopy 2>/dev/null || true

echo "${g}${b}Exact Typer $version is in:${x} $DEST"
echo "${d}(Keep this folder. Chrome loads the extension from it.)${x}"
echo

if [ "$updated" = 1 ]; then
  echo "${b}Updated.${x} If Exact Typer is already in Chrome, open chrome://extensions"
  echo "and click the round arrow (reload) on Exact Typer. That's it."
  echo
  echo "If it is not in Chrome yet, do the steps below."
  echo
fi

echo "${b}Finish in Chrome (one time, about 20 seconds):${x}"
echo "  1. In the Chrome tab that just opened (chrome://extensions),"
echo "     turn on ${b}Developer mode${x} (switch at the top right)."
echo "  2. Click ${b}Load unpacked${x}."
echo "  3. In the window that opens, press ${b}Cmd+Shift+G${x}, then ${b}Cmd+V${x} (the folder"
echo "     path is already copied), press ${b}Return${x}, then click ${b}Select${x}."
echo "  4. Pin it: click the puzzle-piece icon in Chrome's toolbar, then the pin"
echo "     next to Exact Typer."
echo

if [ -z "${EXACT_TYPER_NO_OPEN:-}" ]; then
  if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
    open -a "Google Chrome" "chrome://extensions/" 2>/dev/null \
      || echo "Open Chrome and go to chrome://extensions to continue."
  else
    echo "${r}Google Chrome was not found.${x} Install Chrome, then open chrome://extensions"
    echo "and follow the steps above. (Edge and Brave work too: edge://extensions, brave://extensions.)"
  fi
fi
