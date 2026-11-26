# 用本机真 PowerPoint（COM）打开改配色产物，验证自动化证明不了的三条：
#   1. 页数与源文件一致
#   2. 图表对象还能双击编辑（ChartData 能加载内嵌工作簿）
#   3. 导出每页 PNG 供人眼核对
#
# 为什么必须用 PowerPoint 而不是 LibreOffice 转 PDF：
#   图表是「图表对象 + 内嵌 xlsx」的复合体。LibreOffice 渲染出来对，不等于
#   PowerPoint 里双击还能进编辑态 —— 后者依赖 ppt/charts/chartN.xml 与
#   ppt/embeddings/WorkbookN.xlsx 的关联关系完好，只有真实的 PowerPoint 会去走这条路径。
#
# 用法：
#   python -I verify/run_powerpoint_check.py [产物.pptx]
# 产物：
#   verify/shots/pp-源/*.png      源文件逐页渲染
#   verify/shots/pp-产物/*.png    产物逐页渲染
#   verify/pp-report.json         机器可读结论

import json
import pathlib
import shutil
import sys
import tempfile

import win32com.client

REPO = pathlib.Path(r"D:\21952\Documents\p着玩\bro问我DS网页版报表PPT")
SRC = REPO / "20261121_V4_2026年辅料采购年终汇报.pptx"
DEFAULT_OUT = REPO / "main/chat-demo/verify/dist/out-recolored.pptx"
SHOTS = REPO / "main/chat-demo/verify/shots"
REPORT = REPO / "main/chat-demo/verify/pp-report.json"

# PowerPoint 常量
msoChart = 3
ppAlertsNone = 1


def describe(shape, slide_idx):
    """把一个 Shape 摊平成可判断的记录。"""
    rec = {"slide": slide_idx, "name": shape.Name, "type": shape.Type}
    if shape.Type == msoChart:
        rec["isChart"] = True
        # ChartData 在图表数据不可编辑时（例如被转成图片、关联的 xlsx 丢了）会抛异常。
        # 这是「能不能双击编辑」最硬的判据。
        try:
            wb = shape.Chart.ChartData.Workbook
            sheet = wb.Worksheets(1)
            used = int(sheet.UsedRange.Rows.Count)
            rec["chartDataOk"] = True
            rec["chartSeriesCount"] = int(shape.Chart.SeriesCollection().Count)
            rec["chartDataRows"] = used
            # 顺手取第一个数据点，确认取得到真实数值而不是空壳
            try:
                rec["firstValue"] = float(shape.Chart.SeriesCollection(1).Values[1])
            except Exception as e:  # noqa: BLE001
                rec["firstValueError"] = str(e)
            wb.Close(SaveChanges=False)
        except Exception as e:  # noqa: BLE001
            rec["chartDataOk"] = False
            rec["chartDataError"] = str(e)
    return rec


def inspect(app, path, shot_dir):
    # 拷一份进临时目录再打开，绝不碰原件
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="ppcheck-"))
    copy = tmp / path.name
    shutil.copy2(path, copy)

    pres = app.Presentations.Open(str(copy), ReadOnly=True, WithWindow=False)
    try:
        info = {
            "file": path.name,
            "slides": int(pres.Slides.Count),
            "charts": [],
        }
        shot_dir.mkdir(parents=True, exist_ok=True)
        # 清掉上一次的残留，避免新旧页混在一起看
        for old in shot_dir.glob("slide-*.png"):
            old.unlink()
        for i in range(1, pres.Slides.Count + 1):
            slide = pres.Slides(i)
            for j in range(1, slide.Shapes.Count + 1):
                shape = slide.Shapes(j)
                if shape.Type == msoChart:
                    info["charts"].append(describe(shape, i))
            # 逐页导出 PNG：导整份再拆也行，但逐页导出能保证命名与页号对应
            slide.Export(str(shot_dir / f"slide-{i:02d}.png"), "PNG", 1920, 1080)
        return info
    finally:
        pres.Close()
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    if not out.exists():
        raise SystemExit(f"产物不存在：{out}")

    app = win32com.client.DispatchEx("PowerPoint.Application")
    app.DisplayAlerts = ppAlertsNone
    report = {}
    try:
        report["source"] = inspect(app, SRC, SHOTS / "pp-源")
        report["output"] = inspect(app, out, SHOTS / "pp-产物")
    finally:
        try:
            app.Quit()
        except Exception:  # noqa: BLE001
            pass

    s, o = report["source"], report["output"]

    # 「还能双击编辑」：产物里每个图表都要 chartDataOk。
    # 注意形状名都叫 "Chart"，不能拿名字当 key —— 会把 7 个图表塌成一个。
    # 用 (页号, 该页内第几个图表) 做身份，再比数值。
    def by_slide_index(charts):
        seen = {}
        out_map = {}
        for c in charts:
            key = c["slide"]
            seen[key] = seen.get(key, 0) + 1
            out_map[(key, seen[key])] = c
        return out_map

    src_map = by_slide_index(s["charts"])
    out_map = by_slide_index(o["charts"])

    verdict = {
        "页数一致": s["slides"] == o["slides"],
        "图表数一致": len(s["charts"]) == len(o["charts"]),
        "页数": f'{s["slides"]} → {o["slides"]}',
        "图表数": f'{len(s["charts"])} → {len(o["charts"])}',
        "图表可编辑": all(c.get("chartDataOk") for c in o["charts"]),
        "图表数据未变": (
            src_map.keys() == out_map.keys()
            and all(src_map[k].get("firstValue") == out_map[k].get("firstValue") for k in src_map)
        ),
    }
    report["verdict"] = verdict
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(verdict, ensure_ascii=False, indent=2))
    print()
    for side in ("source", "output"):
        print(f'[{side}] {report[side]["slides"]} 页，{len(report[side]["charts"])} 个图表')
        for c in report[side]["charts"]:
            print("   ", json.dumps(c, ensure_ascii=False))

    if not (verdict["页数一致"] and verdict["图表可编辑"] and verdict["图表数据未变"]):
        sys.exit(1)


if __name__ == "__main__":
    main()
