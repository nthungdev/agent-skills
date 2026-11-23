#!/usr/bin/env bash
# Headless-first Android capture script for demo-capture
#
# Usage:
#   capture-android.sh --output-dir "$DEMO_DIR" --screenshot home
#   capture-android.sh --avd Pixel_8 --package com.example.app --output-dir "$DEMO_DIR" --record feature --duration 5
#
set -euo pipefail

# Find adb & emulator
ADB="${ADB:-$(which adb 2>/dev/null || echo "$HOME/Library/Android/sdk/platform-tools/adb")}"
EMULATOR="${EMULATOR:-$(which emulator 2>/dev/null || echo "$HOME/Library/Android/sdk/emulator/emulator")}"

AVD_NAME="${AVD:-}"
PACKAGE_NAME=""
ACTIVITY_NAME=""
APK_PATH=""
OUTPUT_DIR="./tmp/demos"
ACTION="screenshot" # screenshot | record
NAME="capture"
DURATION=5
FALLBACK_TO_HEADED=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --avd) AVD_NAME="$2"; shift 2 ;;
    --package) PACKAGE_NAME="$2"; shift 2 ;;
    --activity) ACTIVITY_NAME="$2"; shift 2 ;;
    --apk) APK_PATH="$2"; shift 2 ;;
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

if [ ! -x "$ADB" ]; then
  echo "Error: adb not found at $ADB" >&2
  exit 1
fi

# Check if an emulator or device is already running
RUNNING_DEVICES=$("$ADB" devices | grep -v "List of devices" | grep "device$" || true)

if [ -z "$RUNNING_DEVICES" ]; then
  if [ -z "$AVD_NAME" ]; then
    if [ -x "$EMULATOR" ]; then
      AVD_NAME=$("$EMULATOR" -list-avds | head -n 1 || true)
    fi
  fi
  if [ -z "$AVD_NAME" ]; then
    echo "Error: No active Android device and no AVD specified/available." >&2
    exit 1
  fi

  echo "[demo-capture:Android] Booting emulator $AVD_NAME headlessly (-no-window)..."
  "$EMULATOR" -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect >/dev/null 2>&1 &
  EMU_PID=$!

  echo "[demo-capture:Android] Waiting for device to boot..."
  "$ADB" wait-for-device
  BOOT_OK=false
  for i in {1..30}; do
    BOOT_COMPL=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
    if [ "$BOOT_COMPL" = "1" ]; then
      BOOT_OK=true
      break
    fi
    sleep 2
  done

  if [ "$BOOT_OK" != "true" ]; then
    if [ "$FALLBACK_TO_HEADED" = true ]; then
      echo "[demo-capture:Android] Headless boot timed out. Killing and attempting headed fallback..."
      kill "$EMU_PID" 2>/dev/null || true
      "$EMULATOR" -avd "$AVD_NAME" >/dev/null 2>&1 &
      "$ADB" wait-for-device
      sleep 10
    else
      echo "Error: Headless boot failed." >&2
      exit 1
    fi
  else
    echo "[demo-capture:Android] Emulator booted successfully in headless mode."
  fi
else
  echo "[demo-capture:Android] Using active device: $(echo "$RUNNING_DEVICES" | head -n 1 | awk '{print $1}')"
fi

# Optional: install APK
if [ -n "$APK_PATH" ] && [ -f "$APK_PATH" ]; then
  echo "[demo-capture:Android] Installing APK $APK_PATH..."
  "$ADB" install -r "$APK_PATH"
fi

# Optional: launch app
if [ -n "$PACKAGE_NAME" ]; then
  if [ -n "$ACTIVITY_NAME" ]; then
    COMPONENT="$PACKAGE_NAME/$ACTIVITY_NAME"
  else
    COMPONENT="$PACKAGE_NAME"
  fi
  echo "[demo-capture:Android] Launching $COMPONENT..."
  "$ADB" shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || \
    "$ADB" shell am start -n "$COMPONENT" >/dev/null 2>&1 || true
  sleep 2
fi

if [ "$ACTION" = "screenshot" ]; then
  OUT_FILE="$OUTPUT_DIR/${NAME}.png"
  echo "[demo-capture:Android] Capturing screenshot to $OUT_FILE..."
  "$ADB" exec-out screencap -p > "$OUT_FILE"
  echo "[demo-capture:Android] Saved: $OUT_FILE"
elif [ "$ACTION" = "record" ]; then
  DEVICE_TMP="/sdcard/demo_${NAME}_$$.mp4"
  OUT_FILE="$OUTPUT_DIR/videos/${NAME}.mp4"
  echo "[demo-capture:Android] Recording video for ${DURATION}s..."
  "$ADB" shell screenrecord "$DEVICE_TMP" &
  REC_PID=$!
  sleep "$DURATION"
  kill -2 "$REC_PID" 2>/dev/null || true
  "$ADB" shell pkill -2 screenrecord 2>/dev/null || true
  sleep 1
  "$ADB" pull "$DEVICE_TMP" "$OUT_FILE" >/dev/null 2>&1
  "$ADB" shell rm -f "$DEVICE_TMP" 2>/dev/null || true
  echo "[demo-capture:Android] Saved video: $OUT_FILE"
fi

echo "[demo-capture:Android] Done."
