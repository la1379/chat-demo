# 用本机 Edge 在真实浏览器里跑改配色引擎；用法见同目录 README.md
import base64
import json
import pathlib
import time

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(r"D:\21952\Documents\p着玩\bro问我DS网页版报表PPT")
PPTX = REPO / "20261121_V4_2026年辅料采购年终汇报.pptx"
DIST = REPO / "main/chat-demo/verify/dist"
OUT = DIST / "out-recolored.pptx"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def ensure_page(dist: pathlib.Path) -> pathlib.Path:
    """
    验证 bundle 没有 HtmlRspackPlugin（它是主构建的插件，probe 配置里被过滤掉了），
    且 rspack 的 output.clean 会把上一次生成的 index.html 一起删掉。
    所以每次跑之前自己写一个 —— 不能指望仓库里存着一份。
    """
    scripts = sorted((dist / "static/js").glob("main.*.js"))
    if not scripts:
        raise SystemExit(f"没找到 bundle，先跑 rspack build -c verify/rspack.probe.config.ts\n{dist}")
    html = (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<title>recolor-probe</title></head><body>"
        f'<script src="static/js/{scripts[0].name}"></script>'
        "</body></html>"
    )
    page = dist / "index.html"
    page.write_text(html, encoding="utf-8")
    return page


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=EDGE, headless=True)
    page = browser.new_page()
    page.on("pageerror", lambda e: print("[pageerror]", e))
    page.on("console", lambda m: print(f"[{m.type}]", m.text) if m.type in ("error", "warning") else None)

    page.goto(ensure_page(DIST).as_uri())

    page.wait_for_function("typeof window.__runRecolor === 'function'", timeout=30000)
    print("bundle ready")

    b64 = base64.b64encode(PPTX.read_bytes()).decode()
    print("source bytes:", len(base64.b64decode(b64)))

    t0 = time.time()
    result = page.evaluate("([d,h]) => window.__runRecolor(d,h,true)", [b64, 215])
    print(f"run took {int((time.time()-t0)*1000)} ms")

    out_b64 = result.pop("outB64")
    imgs = result.pop("images")
    result["images"] = {
        "changed": imgs["changed"],
        "skipped": len(imgs["skipped"]),
        "profiles": len(imgs["profiles"]),
        "skippedDetail": imgs["skipped"][:5],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    OUT.write_bytes(base64.b64decode(out_b64))
    print("wrote", OUT, OUT.stat().st_size, "bytes")
    browser.close()
