"""Windows 上打 Linux 权限正确的 tar.gz。

为什么不用 GNU tar：NTFS 不保留执行位，cmd/ 下脚本解到 Linux 变 644，
fnOS 调 cmd/main 直接 Permission denied。这里逐成员写 mode：cmd/ 755，其余 644。
"""
import sys
import tarfile
from pathlib import Path


def pack(src: Path, dst: Path):
    with tarfile.open(dst, "w:gz", format=tarfile.GNU_FORMAT) as tar:
        for item in sorted(src.rglob("*")):
            rel = item.relative_to(src).as_posix()
            info = tar.gettarinfo(str(item), arcname=rel)
            if item.is_dir():
                info.mode = 0o755
            elif rel.startswith("cmd/") or rel == "cmd":
                info.mode = 0o755
            else:
                info.mode = 0o644
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            if item.is_file():
                with item.open("rb") as f:
                    tar.addfile(info, f)
            else:
                tar.addfile(info)
    print(f"打包完成：{dst} ({dst.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("用法: python pack-tar.py <源目录> <输出.tar.gz>")
        sys.exit(2)
    pack(Path(sys.argv[1]), Path(sys.argv[2]))
