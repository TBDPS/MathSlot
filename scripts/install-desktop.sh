#!/usr/bin/env bash
# ==============================================================================
# MathSlot Linux 原生桌面与 Wayland 图标一键安装脚本
# 适用平台：Fedora, Ubuntu, Debian, Arch 等遵循 XDG 标准的 Linux 桌面系统 (GNOME / KDE)
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> [MathSlot] 正在准备安装 Linux 原生桌面集成组件..."

# 1. 确保目标目录存在
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_BASE="${HOME}/.local/share/icons/hicolor"

mkdir -p "${BIN_DIR}"
mkdir -p "${APP_DIR}"

# 2. 安装可执行文件
TARGET_BIN="${PROJECT_ROOT}/target/release/mathslot"
if [ ! -f "${TARGET_BIN}" ]; then
    echo "==> 未发现 release 构建，正在执行 cargo build --release..."
    (cd "${PROJECT_ROOT}" && cargo build --release)
fi

echo "==> 复制二进制文件至 ${BIN_DIR}/mathslot ..."
cp -f "${TARGET_BIN}" "${BIN_DIR}/mathslot"
chmod +x "${BIN_DIR}/mathslot"

# 3. 安装各分辨率图标至 hicolor 图标主题目录
echo "==> 安装应用程序图标至 ${ICON_BASE} ..."
for SIZE in 16 32 48 64 128 256; do
    SIZE_DIR="${ICON_BASE}/${SIZE}x${SIZE}/apps"
    mkdir -p "${SIZE_DIR}"
    if [ -f "${PROJECT_ROOT}/assets/icons/mathslot-${SIZE}.png" ]; then
        cp -f "${PROJECT_ROOT}/assets/icons/mathslot-${SIZE}.png" "${SIZE_DIR}/mathslot.png"
    fi
done

# 4. 安装矢量 SVG 图标
SCALABLE_DIR="${ICON_BASE}/scalable/apps"
mkdir -p "${SCALABLE_DIR}"
if [ -f "${PROJECT_ROOT}/assets/icons/mathslot.svg" ]; then
    cp -f "${PROJECT_ROOT}/assets/icons/mathslot.svg" "${SCALABLE_DIR}/mathslot.svg"
fi

# 5. 安装 Desktop 入口文件
echo "==> 安装桌面入口至 ${APP_DIR}/mathslot.desktop ..."
cp -f "${PROJECT_ROOT}/assets/mathslot.desktop" "${APP_DIR}/mathslot.desktop"

# 6. 刷新桌面数据库与图标缓存
echo "==> 正在刷新系统桌面与图标数据库..."
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "${APP_DIR}" >/dev/null 2>&1 || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "${ICON_BASE}" >/dev/null 2>&1 || true
fi

echo "=============================================================================="
echo "✓ MathSlot 桌面集成安装成功！"
echo "  - 二进制路径:  ${BIN_DIR}/mathslot"
echo "  - 桌面入口项:  ${APP_DIR}/mathslot.desktop"
echo "  - 图标资源库:  ${ICON_BASE}/ (16x16 ~ 256x256 及 scalable SVG)"
echo "  - Wayland 匹配: StartupWMClass=mathslot, with_app_id('mathslot')"
echo "=============================================================================="
