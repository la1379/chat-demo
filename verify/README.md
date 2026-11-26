# 改配色引擎验证

**这部分代码不进正式构建产物。** 它只做一件事：在真实浏览器里跑一遍
`src/services/pptx/*`，用真实 pptx 文件验证交付的那份 TS 代码能跑。

为什么必须这样验：改配色依赖 `Blob`、`OffscreenCanvas`、`createImageBitmap`，
Node 里没有这些 API。Python 侧的等效实现只能证明算法思路，证明不了这份产物。

## 跑法

```bash
cd main/chat-demo

# 1. 打验证 bundle（输出到 verify/dist，不影响 dist/）
./node_modules/.bin/rspack build -c verify/rspack.probe.config.ts

# 2. 用本机 Edge 跑（PPTX 路径在脚本顶部改）
python -I verify/run_recolor.py
```

产物：`verify/dist/out-recolored.pptx`

## 检查清单

| 检查 | 判据 | 2026-11-26 实测 |
|---|---|---|
| 颜色确实换了 | 橙色系全部变成目标色相 | `FF6900`×323 → `006BFF`、`A34716`×127 → `165BA3` |
| 中性色没误伤 | 灰阶次数不变 | `333333`/`404040`/`D9DDE2` 次数完全一致 |
| 结构没动 | zip 条目数与条目名一致 | 150 → 150，名字集合相同 |
| XML 未损坏 | 全部部件可解析 | 150 个部件，0 畸形 |
| 能被 Office 打开 | LibreOffice 转 PDF 页数一致 | 源 11 页 → 产物 11 页 |
| 耗时 | 3.9 MB 应远低于 5 秒 | 1252 ms |

## 注意

- 本机 Playwright 的 chromium 下载可能"假成功"，脚本显式指定系统 Edge。
- `python -I` 必要：临时目录里若有同名 `.py` 会劫持标准库导入（踩过 `bisect.py`）。
- 图片换色在真实文件上是保守的：7 张图里只改 3 张，EMF 与照片类按设计跳过。
