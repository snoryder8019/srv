#!/bin/bash
# Rust Dedicated Server Installer
# Installs Rust server + Oxide (uMod) mod framework into /srv/games/rust/

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
RUST_DIR="/srv/games/rust"
RUST_APP_ID="258550"

echo "=== Installing Rust Dedicated Server ==="
$STEAMCMD +force_install_dir "$RUST_DIR" +login anonymous +app_update $RUST_APP_ID validate +quit

echo ""
echo "=== Installing Oxide/uMod ==="
OXIDE_URL=$(curl -s https://api.github.com/repos/OxideMod/Oxide.Rust/releases/latest | grep browser_download_url | grep "Oxide.Rust.zip" | cut -d '"' -f 4)
if [ -z "$OXIDE_URL" ]; then
    echo "Could not fetch Oxide URL. Check https://umod.org/games/rust manually."
else
    curl -L "$OXIDE_URL" -o /tmp/Oxide.Rust.zip
    unzip -o /tmp/Oxide.Rust.zip -d "$RUST_DIR"
    rm /tmp/Oxide.Rust.zip
    echo "Oxide installed."
fi

echo ""
echo "=== Done! Run ./start-rust.sh to launch the server ==="
