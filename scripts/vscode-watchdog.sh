#!/bin/bash
# Kill runaway VS Code extension host processes eating >20% RAM
THRESHOLD=20

while IFS= read -r line; do
  PID=$(echo "$line" | awk '{print $2}')
  MEM=$(echo "$line" | awk '{print $4}')
  CMD=$(echo "$line" | awk '{print $11}')

  # Check if it's a vscode extension host specifically
  if echo "$CMD" | grep -q "vscode" && ps -p "$PID" -o args= 2>/dev/null | grep -q "extensionHost"; then
    INT_MEM=$(echo "$MEM" | cut -d. -f1)
    if [ "$INT_MEM" -gt "$THRESHOLD" ]; then
      echo "$(date): Killing runaway VSCode extensionHost PID $PID using ${MEM}% RAM" >> /var/log/vscode-watchdog.log
      kill "$PID"
    fi
  fi
done < <(ps aux | awk 'NR>1')
