#!/usr/bin/env bash
# Prints what happened after a failed Maestro run, while the emulator is still up. Run by the
# "Run Maestro flows on an emulator" step in ci.yml; every command is best-effort.
set +e

echo "=== Maestro commands (status, command) ==="
find "$RUNNER_TEMP/maestro-debug" -name 'commands-*.json' -exec jq -c '.[] | {status: .metadata.status, command: (.command | keys)}' {} \; 2>&1 | head -80

echo "=== Metro log (tail) ==="
tail -n 40 "$RUNNER_TEMP/metro.log"

echo "=== Text visible on screen ==="
adb shell uiautomator dump /sdcard/ui.xml > /dev/null
adb shell cat /sdcard/ui.xml | grep -oE '(text|content-desc)="[^"]+"' | sort -u

echo "=== logcat (filtered) ==="
adb logcat -d -t 800 | grep -iE 'ReactNativeJS|AndroidRuntime|FATAL|expo' | tail -60

adb exec-out screencap -p > "$RUNNER_TEMP/final-screen.png"
