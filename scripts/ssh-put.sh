#!/bin/bash
# 用 base64 经 stdin 把本地文件推到 NAS 指定路径，用法：
#   bash scripts/ssh-put.sh <本地文件> <远端绝对路径>
# 输出末行为远端字节数，调用方可据此校验是否传完整。
#
# 为什么不用 ssh-run.ps1：实测脚本体超过约 10～60 KB 后，pwsh 里
# `& ssh ...` 会报 "StandardErrorEncoding is only supported when standard
# error is redirected"（编码选项与重定向冲突）而失败。传二进制文件走
# stdin 管道，完全绕开那条路径。
#
# 为什么 askpass 垫片放 $TEMP：ssh.exe 用 posix_spawnp 打开 askpass，
# 含中文的路径会 "No such file or directory"（NAS 维护工作区踩过）。
# 口令仍只存在于既有载体 .sshpass_askpass.cmd，垫片每次生成、不累积。
set -eu

SRC="${1:?用法: ssh-put.sh <本地文件> <远端路径>}"
DEST="${2:?用法: ssh-put.sh <本地文件> <远端路径>}"

CARRIER='D:/MyProjects/W.FNOS维护/.sshpass_askpass.cmd'
[ -f "$CARRIER" ] || { echo "口令载体不存在: $CARRIER" >&2; exit 1; }

# 载体是 batch 文件，口令在唯一一行 echo 后面
PW=$(grep -iE '^[[:space:]]*echo[[:space:]]+' "$CARRIER" | head -1 | sed -E 's/^[[:space:]]*[Ee][Cc][Hh][Oo][[:space:]]+//' | tr -d '\r')
[ -n "$PW" ] || { echo "口令载体为空" >&2; exit 1; }

SHIM_DIR="${TEMP:-/tmp}"
SHIM="$SHIM_DIR/dsh-askpass.sh"
# 单引号包裹口令，避免 # * 等被 shell 解释
printf '#!/bin/sh\necho %s\n' "'$PW'" > "$SHIM"
chmod +x "$SHIM"

export SSH_ASKPASS="$SHIM" SSH_ASKPASS_REQUIRE=force DISPLAY=localhost:0

base64 -w0 "$SRC" | ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=20 panyunmeng@panyunmeng.cn \
    "base64 -d > '$DEST' && wc -c < '$DEST'"
