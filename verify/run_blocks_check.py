# 对话块渲染验证：图表 / 邮件 / 清单，亮暗两套主题 + 清单持久化
# 用法：先 rspack build -c verify/rspack.blocks.config.ts，再跑本脚本
import pathlib
from playwright.sync_api import sync_playwright

DIST = pathlib.Path(__file__).parent / "dist"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# 手写 HTML 时必须同时引 CSS —— 忘了引会得到「样式规则存在但不生效」，
# 排查成本很高（曾误以为 CSS 写错了）
JS = next((DIST / "static/js").glob("main.*.js")).name
CSS = next((DIST / "static/css").glob("main.*.css")).name
(DIST / "index.html").write_text(
    f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />'
    f'<link rel="stylesheet" href="./static/css/{CSS}" /></head>'
    f'<body><div id="root"></div><script src="./static/js/{JS}"></script></body></html>',
    encoding="utf-8",
)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EDGE, headless=True)
    for theme in ("light", "dark"):
        page = b.new_page(viewport={"width": 880, "height": 1400}, color_scheme=theme)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.goto((DIST / "index.html").as_uri())
        page.wait_for_timeout(1200)
        counts = page.evaluate("""() => ({
          charts: document.querySelectorAll('svg[role=img]').length,
          checkboxes: document.querySelectorAll('input[type=checkbox]').length,
          raw: document.querySelectorAll('pre').length,
        })""")
        print(f"[{theme}]", counts, "errors:", errs)
        page.screenshot(path=str(DIST.parent / f"shots/blocks-{theme}.png"), full_page=True)

        if theme == "light":
            box = page.locator("input[type=checkbox]").nth(0)
            before = box.is_checked()
            box.click()
            page.wait_for_timeout(200)
            page.reload()
            page.wait_for_timeout(900)
            after = page.locator("input[type=checkbox]").nth(0).is_checked()
            print(f"勾选持久化：之前={before} 刷新后={after} ->", "OK" if after != before else "FAIL")
        page.close()
    b.close()
