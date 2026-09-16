#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ROCKS_DIR="$ROOT_DIR/.rocks"
LUAROCKS_VERSION="3.13.0"
BUILD_DIR=$(mktemp -d)
ARCHIVE="$BUILD_DIR/luarocks-$LUAROCKS_VERSION.tar.gz"
SRC_DIR="$BUILD_DIR/luarocks-$LUAROCKS_VERSION"
URL="https://luarocks.org/releases/luarocks-$LUAROCKS_VERSION.tar.gz"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT INT TERM

LUAJIT_DIR=$(mise where luajit)

if [ ! -d "$ROCKS_DIR/lib/luarocks" ]; then
  curl -fsSL "$URL" -o "$ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$BUILD_DIR"

  cd "$SRC_DIR"
  ./configure \
    --prefix="$ROCKS_DIR" \
    --lua-version=5.1 \
    --with-lua="$LUAJIT_DIR"

  make
  make install
fi

cd "$ROOT_DIR"
"$ROCKS_DIR/bin/luarocks" make --deps-only ./steamapp-verlock-dev-1.rockspec
