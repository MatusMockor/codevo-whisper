#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pkill -f "Electron.app/Contents/MacOS/Electron $ROOT" && echo "stopped" || echo "not running"
