#!/bin/bash
# install-minecraft.sh — Install PaperMC 1.21.4 locally for testing
# Usage: bash install-minecraft.sh [slot_number]
# Slot 0 = port 25565, slot 1 = 25566, etc.

set -e
SLOT=${1:-0}
DIR="/srv/games/minecraft/slot${SLOT}"
PORT=$((25565 + SLOT))
HEAP="1024M"
[ "$SLOT" -eq 3 ] && HEAP="768M"

PAPER_VERSION="1.21.4"
PAPER_BUILD="192"
PAPER_URL="https://api.papermc.io/v2/projects/paper/versions/${PAPER_VERSION}/builds/${PAPER_BUILD}/downloads/paper-${PAPER_VERSION}-${PAPER_BUILD}.jar"

echo "[minecraft] Installing slot ${SLOT} → ${DIR} (port ${PORT}, heap ${HEAP})"

mkdir -p "${DIR}"

# Download PaperMC
if [ ! -f "${DIR}/paper.jar" ]; then
  echo "[minecraft] Downloading PaperMC ${PAPER_VERSION} build ${PAPER_BUILD}..."
  curl -sSL "${PAPER_URL}" -o "${DIR}/paper.jar"
  echo "[minecraft] Downloaded $(du -sh ${DIR}/paper.jar | cut -f1)"
else
  echo "[minecraft] paper.jar already present — skipping download"
fi

# EULA
echo "eula=true" > "${DIR}/eula.txt"

# server.properties
cat > "${DIR}/server.properties" << PROPS
server-port=${PORT}
server-ip=0.0.0.0
online-mode=false
max-players=20
difficulty=normal
gamemode=survival
allow-nether=true
spawn-protection=16
view-distance=10
simulation-distance=8
motd=MadLadsLab Private Server Slot ${SLOT}
enable-rcon=true
rcon.port=$((25575 + SLOT))
rcon.password=madlads_rcon
PROPS

# JVM flags optimized for Paper (Aikar's flags)
cat > "${DIR}/start.sh" << STARTSCRIPT
#!/bin/bash
cd "${DIR}"
exec java \\
  -Xms512M -Xmx${HEAP} \\
  -XX:+UseG1GC \\
  -XX:+ParallelRefProcEnabled \\
  -XX:MaxGCPauseMillis=200 \\
  -XX:+UnlockExperimentalVMOptions \\
  -XX:+DisableExplicitGC \\
  -XX:+AlwaysPreTouch \\
  -XX:G1NewSizePercent=30 \\
  -XX:G1MaxNewSizePercent=40 \\
  -XX:G1HeapRegionSize=8M \\
  -XX:G1ReservePercent=20 \\
  -XX:G1HeapWastePercent=5 \\
  -XX:G1MixedGCCountTarget=4 \\
  -XX:InitiatingHeapOccupancyPercent=15 \\
  -XX:G1MixedGCLiveThresholdPercent=90 \\
  -XX:G1RSetUpdatingPauseTimePercent=5 \\
  -XX:SurvivorRatio=32 \\
  -XX:+PerfDisableSharedMem \\
  -XX:MaxTenuringThreshold=1 \\
  -Dusing.aikars.flags=https://mcflags.emc.gs \\
  -Daikars.new.flags=true \\
  -jar paper.jar nogui
STARTSCRIPT
chmod +x "${DIR}/start.sh"

echo ""
echo "✅ Slot ${SLOT} installed:"
echo "   Directory : ${DIR}"
echo "   Port      : ${PORT}"
echo "   RCON port : $((25575 + SLOT))"
echo "   Heap      : ${HEAP}"
echo ""
echo "To start in tmux:"
echo "  tmux new-session -d -s mc-slot-${SLOT} 'bash ${DIR}/start.sh'"
echo ""
echo "To start as systemd service (on a Linode):"
echo "  systemctl start mc-slot-${SLOT}"
