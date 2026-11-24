"""下载姿势参考库到 poses/ 目录（网页上的「下载姿势库」按钮做的是同一件事）。

来源：https://github.com/anhao/ai-pose-gallery-zh （在线版 https://ai-pose-gallery.anhao.app/poses）
图片原作者ギア（@giaaibusi），版权归原作者，仅供个人学习创作，不要再分发——所以 poses/ 不进 git。

    .venv\\Scripts\\python scripts\\download_poses.py            # 缩略图 + 深度图 + 白模线稿（约 700 MB）
    .venv\\Scripts\\python scripts\\download_poses.py --no-full  # 不下白模线稿（约 55 MB，只能用深度图控制）

已经下好的文件会跳过，中断了重跑一次即可。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.poses import download_all  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-full", action="store_true", help="不下载白模线稿（PNG，约 640 MB）")
    parser.add_argument("--workers", type=int, default=16)
    args = parser.parse_args()

    def progress(done: int, total: int, failed: int) -> None:
        if done % 200 == 0 or done == total:
            print(f"{done}/{total}  失败 {failed}", flush=True)

    total, errors = download_all(full=not args.no_full, workers=args.workers, on_progress=progress)
    print(f"文件 {total} 个，失败 {len(errors)} 个。")
    for error in errors[:20]:
        print("  ", error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
