# 改配色产物的结构与像素断言（不进产物，跑在 run_recolor.py / run_ui_check.py 之后）
#
# 这个脚本存在的理由：M2.5 真机检查暴露的三个问题，自动化测试一个都没抓到 ——
# 因为当时只断言「页数对、能打开、橙色计数归零」。
# 真正坏掉的是「哪些图不该动却动了」，而那条属于**负向断言**，必须显式写。
#
# 用法：
#   python -I verify/run_artifact_assert.py <产物.pptx>
# 退出码 0 = 全过。

import hashlib
import pathlib
import sys
import zipfile

REPO = pathlib.Path(r"D:\21952\Documents\p着玩\bro问我DS网页版报表PPT")
SRC = REPO / "20261121_V4_2026年辅料采购年终汇报.pptx"

# 这些图在源文件里的真实身份（人工看过）：
#   image1/2.emf  版面装饰（左侧竖条 + 笑脸，单色矢量，画刷 F15C19）→ 应该动
#   image3.png    两色品牌 logo（WKChef 橙 + 金龙鱼红）→ 不能动
#   image7.png    橙色勾选圆形图标（单色）→ 应该动
#   image8.png    页眉品牌 logo 条 → 不能动
#   image9.png    待交付明细截图（白底表格）→ 不能动
#   image5.png    1.8MB 背景照片 → 不能动
MUST_NOT_CHANGE = ["image3.png", "image5.png", "image8.png", "image9.png"]
MUST_CHANGE = ["image7.png", "image1.emf", "image2.emf"]


def digest(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()[:16]


def check_structure(src: zipfile.ZipFile, out: zipfile.ZipFile, fail: list):
    a, b = set(src.namelist()), set(out.namelist())
    if a != b:
        fail.append(f"zip 条目名不一致：少 {sorted(a - b)[:5]}，多 {sorted(b - a)[:5]}")
    slides = [n for n in a if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
    out_slides = [n for n in b if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
    if len(slides) != len(out_slides):
        fail.append(f"页数变了：{len(slides)} → {len(out_slides)}")
    # 内嵌工作簿必须逐字节不变：图表能不能双击编辑全靠它
    emb = [n for n in a if n.startswith("ppt/embeddings/") and n.endswith((".xlsx", ".bin"))]
    for n in emb:
        if src.read(n) != out.read(n):
            fail.append(f"内嵌工作簿被改动：{n}（图表将无法编辑）")


def check_images(src: zipfile.ZipFile, out: zipfile.ZipFile, fail: list) -> dict:
    media = sorted(n for n in src.namelist() if n.startswith("ppt/media/") and src.getinfo(n).file_size)
    report = {}
    for n in media:
        name = pathlib.PurePosixPath(n).name
        same = src.read(n) == out.read(n)
        report[name] = "SAME" if same else "CHANGED"
        if name in MUST_NOT_CHANGE and not same:
            fail.append(f"{name} 不该被改却被改了（多色 logo / 截图 / 照片）")
        if name in MUST_CHANGE and same:
            fail.append(f"{name} 应该被改却没改（单色图标 / 单色矢量装饰）")
        # EMF 换色只许改 COLORREF 这 4 个字节，文件长度和记录结构必须原样 ——
        # EMF 里的偏移是绝对地址，长度一变整张图就废了
        if name.lower().endswith(".emf") and not same:
            a, b = src.read(n), out.read(n)
            if len(a) != len(b):
                fail.append(f"{name} 长度变了：{len(a)} → {len(b)}（EMF 偏移会全废）")
            else:
                diff = sum(1 for x, y in zip(a, b) if x != y)
                if diff > 4:
                    fail.append(f"{name} 改了 {diff} 个字节，超出单个 COLORREF 的预期")
    return report


def check_colors(src: zipfile.ZipFile, out: zipfile.ZipFile, fail: list) -> dict:
    """橙色系必须清零；但近白底纹（HSV 低饱和）不在检查范围 —— 它跟着品牌色走是对的"""
    import re

    def orange_hits(z: zipfile.ZipFile) -> dict:
        hits = {}
        for n in z.namelist():
            if not n.endswith(".xml"):
                continue
            text = z.read(n).decode("utf8", "ignore")
            for m in re.finditer(r'(?:srgbClr|lastClr)\b[^>]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"', text):
                hexv = m.group(1).upper()
                r, g, b = (int(hexv[i:i + 2], 16) for i in (0, 2, 4))
                mx, mn = max(r, g, b), min(r, g, b)
                if mx == 0 or (mx - mn) / mx < 0.45:
                    continue
                # 色相 15-50 度 = 橙/琥珀
                import colorsys
                h = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360
                if 15 <= h <= 50:
                    hits[hexv] = hits.get(hexv, 0) + 1
        return hits

    before, after = orange_hits(src), orange_hits(out)
    if after:
        fail.append(f"仍有橙色残留：{after}")
    return {"before": before, "after": after}


def main() -> int:
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "main/chat-demo/verify/dist/out-recolored.pptx"
    if not target.exists():
        raise SystemExit(f"产物不存在：{target}")

    fail: list[str] = []
    with zipfile.ZipFile(SRC) as src, zipfile.ZipFile(target) as out:
        check_structure(src, out, fail)
        images = check_images(src, out, fail)
        colors = check_colors(src, out, fail)

    print(f"产物：{target.name}  ({target.stat().st_size} bytes)")
    print("图片：")
    for name, state in images.items():
        mark = "  " if state == "SAME" else "* "
        print(f"  {mark}{name:16s} {state}")
    print(f"橙色命中：{len(colors['before'])} 种 -> {len(colors['after'])} 种")

    if fail:
        print("\nFAIL")
        for item in fail:
            print("  -", item)
        return 1
    print("\nPASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
