# 布局自检：控件重叠与横向溢出（桌面 + 移动）
import pathlib, re
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(r"D:\21952\Documents\p着玩\bro问我DS网页版报表PPT")
PPTX = REPO / "20261121_V4_2026年辅料采购年终汇报.pptx"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

OVERLAP_JS = """
() => {
  const dialog = document.querySelector('[role=dialog]');
  if (!dialog) return { error: 'no dialog' };
  const els = [...dialog.querySelectorAll('button,input,li')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const bad = [];
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
      // li 内部包含 button/input 是正常的，跳过祖先关系
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const ox = Math.min(a.right,b.right) - Math.max(a.left,b.left);
      const oy = Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top);
      if (ox > 2 && oy > 2) bad.push([els[i].tagName+':'+(els[i].textContent||'').slice(0,10),
                                     els[j].tagName+':'+(els[j].textContent||'').slice(0,10), Math.round(ox)+'x'+Math.round(oy)]);
    }
  }
  // 内容溢出
  const over = [];
  dialog.querySelectorAll('*').forEach(e => {
    if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflowX === 'visible') {
      const t = (e.textContent||'').trim().slice(0,20);
      if (t) over.push(t);
    }
  });
  return { overlaps: bad.slice(0,10), overflowCount: over.length, overflowSample: over.slice(0,5) };
}
"""

def run(page, label):
    page.get_by_role("button", name="给 PPT 换套配色").click()
    page.wait_for_timeout(300)
    with page.expect_file_chooser() as fc:
        page.get_by_role("button", name="选择 .pptx 文件").click()
    fc.value.set_files(str(PPTX))
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="商务藏蓝").click()
    page.wait_for_timeout(600)
    res = page.evaluate(OVERLAP_JS)
    print(f"=== {label} ===")
    print("overlaps:", res.get("overlaps"))
    print("overflow:", res.get("overflowCount"), res.get("overflowSample"))
    page.get_by_label("关闭").first.click()
    page.wait_for_timeout(300)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=EDGE, headless=True)
    for label, w, h, cs in [("desktop-1280", 1280, 800, "light"),
                            ("mobile-390", 390, 844, "light")]:
        page = b.new_page(viewport={"width": w, "height": h}, color_scheme=cs)
        page.goto("http://localhost:8090/", wait_until="networkidle")
        c = page.get_by_label("关闭")
        if c.count():
            c.first.click(); page.wait_for_timeout(300)
        if w < 500:
            page.get_by_role("button", name="给 PPT 换套配色").click()
            page.wait_for_timeout(300)
            page.screenshot(path=str(REPO / f"main/chat-demo/verify/shots/08-{label}.png"))
            with page.expect_file_chooser() as fc:
                page.get_by_role("button", name="选择 .pptx 文件").click()
            fc.value.set_files(str(PPTX))
            page.wait_for_timeout(2500)
            page.get_by_role("button", name="商务藏蓝").click()
            page.wait_for_timeout(600)
            res = page.evaluate(OVERLAP_JS)
            print(f"=== {label} ===")
            print("overlaps:", res.get("overlaps"))
            print("overflow:", res.get("overflowCount"), res.get("overflowSample"))
            page.screenshot(path=str(REPO / f"main/chat-demo/verify/shots/09-{label}-panel.png"))
        else:
            run(page, label)
        page.close()
    b.close()
