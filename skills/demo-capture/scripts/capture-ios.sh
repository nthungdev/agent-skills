#!/usr/bin/env bash
# Headless-first iOS capture script for demo-capture
#
# Usage:
#   capture-ios.sh --device "iPhone 16" --output-dir ./tmp/demos/ticket --screenshot home
#   capture-ios.sh --device "iPhone 16" --bundle-id com.example.app --output-dir ./tmp/demos/ticket --record feature --duration 5
#
set -euo pipefail

DEVICE_NAME_OR_UDID="${DEVICE:-iPhone 16}"
BUNDLE_ID=""
APP_PATH=""
OUTPUT_DIR="./tmp/demos"
ACTION="screenshot" # screenshot | record
NAME="capture"
DURATION=5
FALLBACK_TO_HEADED=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) DEVICE_NAME_OR_UDID="$2"; shift 2 ;;
    --bundle-id) BUNDLE_ID="$2"; shift 2 ;;
    --app) APP_PATH="$2"; shift 2 ;;
    --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
    --screenshot) ACTION="screenshot"; NAME="$2"; shift 2 ;;
    --record) ACTION="record"; NAME="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --no-fallback) FALLBACK_TO_HEADED=false; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"
if [ "$ACTION" = "record" ]; then
  mkdir -p "$OUTPUT_DIR/videos"
fi

# Resolve device UDID
UDID=$(xcrun simctl list devices available | grep -E "${DEVICE_NAME_OR_UDID}" | head -n 1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/' || true)
if [ -z "$UDID" ]; then
  # Try matching directly as UDID
  UDID="$DEVICE_NAME_OR_UDID"
fi

# Check if booted
IS_BOOTED=$(xcrun simctl list devices | grep "$UDID" | grep -q "Booted" && echo "yes" || echo "no")

if [ "$IS_BOOTED" != "yes" ]; then
  echo "[demo-capture:iOS] Attempting headless boot for simulator: $UDID..."
  if xcrun simctl boot "$UDID" 2>/dev/null; then
    echo "[demo-capture:iOS] Simulator booted headlessly."
  else
    if [ "$FALLBACK_TO_HEADED" = true ]; then
      echo "[demo-capture:iOS] Headless boot failed or returned non-zero. Falling back to headed Simulator.app..."
      open -a Simulator --args -CurrentDeviceUDID "$UDID"
      sleep 5
    else
      echo "[demo-capture:iOS] Headless boot failed and fallback is disabled." >&2
      exit 1
    fi
  fi
else
  echo "[demo-capture:iOS] Simulator $UDID is already booted."
fi

# Optional: install app
if [ -n "$APP_PATH" ] && [ -f "$APP_PATH" ]; then
  echo "[demo-capture:iOS] Installing app $APP_PATH..."
  xcrun simctl install "$UDID" "$APP_PATH"
fi

# Optional: launch app
if [ -n "$BUNDLE_ID" ]; then
  echo "[demo-capture:iOS] Launching bundle $BUNDLE_ID..."
  xcrun simctl launch "$UDID" "$BUNDLE_ID" || true
  sleep 2
fi

if [ "$ACTION" = "screenshot" ]; then
  OUT_FILE="$OUTPUT_DIR/${NAME}.png"
  echo "[demo-capture:iOS] Capturing screenshot to $OUT_FILE..."
  if ! xcrun simctl io "$UDID" screenshot "$OUT_FILE"; then
    if [ "$FALLBACK_TO_HEADED" = true ]; then
      echo "[demo-capture:iOS] Screenshot failed headlessly. Launching Simulator.app GUI and retrying..."
      open -a Simulator --args -CurrentDeviceUDID "$UDID"
      sleep 3
      xcrun simctl io "$UDID" screenshot "$OUT_FILE"
    else
      exit 1
    fi
  fi
  echo "[demo-capture:iOS] Saved: $OUT_FILE"
elif [ "$ACTION" = "record" ]; then
  OUT_FILE="$OUTPUT_DIR/videos/${NAME}.mp4"
  echo "[demo-capture:iOS] Recording video for ${DURATION}s to $OUT_FILE..."
  xcrun simctl io "$UDID" recordVideo "$OUT_FILE" &
  REC_PID=$!
  sleep "$DURATION"
  kill -2 "$REC_PID" 2>/dev/null || true
  wait "$REC_PID" 2>/dev/null || true
  echo "[demo-capture:iOS] Saved video: $OUT_FILE"
fi

echo "[demo-capture:iOS] Done."
