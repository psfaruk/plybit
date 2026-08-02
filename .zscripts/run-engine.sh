#!/bin/bash
LOG=/home/z/my-project/.zscripts/mini-service-otc-engine.log
cd /home/z/my-project/mini-services/otc-engine
while true; do
  echo "=== [wrapper] starting at $(date -u +%H:%M:%S) ===" >> "$LOG"
  bun --env-file=/home/z/my-project/.env index.ts >> "$LOG" 2>&1
  echo "=== [wrapper] exited, restarting in 3s ===" >> "$LOG"
  sleep 3
done
