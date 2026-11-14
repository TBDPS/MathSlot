#!/usr/bin/env bash
# ==============================================================================
# MathSlot (Tauri 2) 本地离线原生桌面发布包构建与 SHA256 校验脚本
# 产出位于被 .gitignore 忽略的 target/release-dist/ 下，不污染 git 工作区。
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

DIST_DIR="${PROJECT_ROOT}/target/release-dist"
PKG_NAME="mathslot-desktop-linux-x86_64"
STAGE_DIR="${DIST_DIR}/${PKG_NAME}"
ARCHIVE_NAME="mathslot-desktop-linux-x86_64.tar.gz"

echo "==> [1/4] Building apps/desktop Svelte frontend assets..."
npm --prefix apps/desktop run build

echo "==> [2/4] Building native Tauri 2 binary (cargo build --release --offline -p mathslot-desktop)..."
cargo build --release --offline -p mathslot-desktop

BIN_PATH="${PROJECT_ROOT}/target/release/mathslot-desktop"
if [ ! -x "${BIN_PATH}" ]; then
    echo "Error: expected executable ${BIN_PATH} not found" >&2
    exit 1
fi

echo "==> [3/4] Staging portable native bundle in ${STAGE_DIR}..."
rm -rf "${STAGE_DIR}" "${DIST_DIR}/${ARCHIVE_NAME}" "${DIST_DIR}/SHA256SUMS.txt"
mkdir -p "${STAGE_DIR}/assets" "${STAGE_DIR}/scripts" "${STAGE_DIR}/docs"

cp -f "${BIN_PATH}" "${STAGE_DIR}/mathslot-desktop"
chmod +x "${STAGE_DIR}/mathslot-desktop"
cp -r assets/* "${STAGE_DIR}/assets/"
cp -f scripts/install-desktop.sh "${STAGE_DIR}/scripts/install-desktop.sh"
chmod +x "${STAGE_DIR}/scripts/install-desktop.sh"
cp -f README.md HELP.md "${STAGE_DIR}/"
if [ -f docs/RELEASE_ROLLBACK.md ]; then
    cp -f docs/RELEASE_ROLLBACK.md "${STAGE_DIR}/docs/RELEASE_ROLLBACK.md"
fi

echo "==> [4/4] Creating ${ARCHIVE_NAME} and verifying SHA256SUMS.txt..."
tar -C "${DIST_DIR}" -czf "${DIST_DIR}/${ARCHIVE_NAME}" "${PKG_NAME}"
(
    cd "${DIST_DIR}"
    sha256sum "${ARCHIVE_NAME}" > SHA256SUMS.txt
    sha256sum -c SHA256SUMS.txt
)

ls -lh "${BIN_PATH}" "${DIST_DIR}/${ARCHIVE_NAME}" "${DIST_DIR}/SHA256SUMS.txt"
cat "${DIST_DIR}/SHA256SUMS.txt"
