#!/usr/bin/env bash
# 等 emulator 安装完成后，装 default 镜像并创建 AVD。
# 用法：bash tools/setup-emulator.sh
set -u

SDK="D:/AndroidSdk"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"
AVDMANAGER="$SDK/cmdline-tools/latest/bin/avdmanager.bat"
EMU="$SDK/emulator/emulator.exe"
IMAGE="system-images;android-35;default;x86_64"
AVD_NAME="shunshou"
JAVA_HOME_BIN="C:/Program Files/Eclipse Adoptium/jdk-21.0.12.8-hotspot"

# sdkmanager 走系统代理会失败，必须清掉
unset HTTPS_PROXY HTTP_PROXY ALL_PROXY

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "等待 emulator 安装完成…"
for i in $(seq 1 180); do
  if [ -f "$EMU" ] && [ -x "$EMU" ]; then
    log "emulator 已就绪"
    break
  fi
  if ! ps aux 2>/dev/null | grep -q "[s]dkmanager"; then
    log "sdkmanager 进程已退出，检查 emulator 是否存在"
    if [ -f "$EMU" ]; then log "emulator 已就绪"; break; fi
    log "错误：emulator 未安装成功"
    exit 1
  fi
  sleep 60
done

if [ ! -f "$EMU" ]; then
  log "错误：等待超时，emulator 仍未就绪"
  exit 1
fi

log "安装 default 系统镜像（782MB，预计较久）…"
yes | "$SDKMANAGER" --install "$IMAGE" 2>&1 | grep -E "Unzip|Install|done|Warning" | tail -5

if [ ! -d "$SDK/system-images/android-35/default/x86_64" ]; then
  log "错误：系统镜像未就位"
  exit 1
fi
log "系统镜像已就绪"

log "创建 AVD：$AVD_NAME"
echo "no" | "$AVDMANAGER" create avd \
  --name "$AVD_NAME" \
  --package "$IMAGE" \
  --device "pixel_6" \
  --force 2>&1 | tail -5

if [ -d "$HOME/.android/avd/$AVD_NAME.avd" ]; then
  log "AVD 创建成功"
else
  log "错误：AVD 未创建"
  exit 1
fi

log "全部完成。启动命令："
echo "  \"$EMU\" -avd $AVD_NAME -no-snapshot-save -gpu swiftshader_indirect"
