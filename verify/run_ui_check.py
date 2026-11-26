# 界面验收：走完「入口 → 上传 → 预设 → 下载」全链路
import pathlib
import re
import time

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(r"D:\21952\Documents\p着玩\bro问我DS网页版报表PPT")
PPTX = REPO / "20261121_V4_2026年辅料采购年终汇报.pptx"
SHOTS = REPO / "main/chat-demo/verify/shots"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
URL = "http://localhost:8090/"

SHOTS.mkdir(parents=True, exist_ok=True)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=EDGE, headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)

        page.goto(URL, wait_until="networkidle")
        # 设置弹窗可能因为没 Key 自动弹出来
        close = page.get_by_label("关闭")
        if close.count():
            close.first.click()
            page.wait_for_timeout(300)
        page.screenshot(path=SHOTS / "01-welcome.png")
        print("welcome shot ok")

        # 1. 欢迎页的快捷入口
        shortcut = page.get_by_role("button", name="给 PPT 换套配色")
        print("shortcut visible:", shortcut.is_visible())
        shortcut.click()
        page.wait_for_timeout(400)
        page.screenshot(path=SHOTS / "02-dialog-open.png")
        print("dialog open:", page.get_by_role("dialog").is_visible())

        # 2. 上传文件
        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="选择 .pptx 文件").click()
        fc.value.set_files(str(PPTX))
        page.wait_for_timeout(2500)
        page.screenshot(path=SHOTS / "03-analyzed.png", full_page=True)
        panel_text = page.locator("[role=dialog]").inner_text()
        print("--- panel head ---")
        print("\n".join([l for l in panel_text.splitlines() if l.strip()][:10]))

        # 3. 点一个预设
        presets = page.get_by_role("button", name="商务藏蓝")
        print("preset found:", presets.count())
        presets.first.click()
        page.wait_for_timeout(600)
        page.screenshot(path=SHOTS / "04-preset-applied.png", full_page=True)
        after = page.locator("[role=dialog]").inner_text()
        print("--- after preset ---")
        print("\n".join([l for l in after.splitlines() if l.strip()][:8]))

        # 4. 下载
        btn = page.get_by_role("button", name=re.compile(r"^下载"))
        print("download btn count:", btn.count())
        with page.expect_download(timeout=120000) as dl:
            btn.first.click()
        download = dl.value
        out = SHOTS.parent / "ui-downloaded.pptx"
        download.save_as(str(out))
        print("downloaded:", out.name, out.stat().st_size, "bytes")

        # 5. 关掉弹窗，再从侧边栏打开一次
        page.get_by_label("关闭").first.click()
        page.wait_for_timeout(300)
        sider_btn = page.get_by_role("button", name="改 PPT 配色")
        print("sider entry count:", sider_btn.count())
        if sider_btn.count():
            sider_btn.first.click()
            page.wait_for_timeout(400)
            page.screenshot(path=SHOTS / "05-reopen-from-sider.png")
            print("reopened:", page.get_by_role("dialog").is_visible())
            page.get_by_label("关闭").first.click()

        print("--- errors ---")
        for e in errors:
            print(e)
        print("total errors:", len(errors))
        browser.close()


if __name__ == "__main__":
    t0 = time.time()
    main()
    print(f"done in {int((time.time()-t0)*1000)} ms")
