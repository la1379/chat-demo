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

# 3. 结构 / 像素断言（负向断言，见下方「为什么需要这一步」）
python -I verify/run_artifact_assert.py

# 4. 真 PowerPoint 复核 + 逐页导出 PNG
python -I verify/run_powerpoint_check.py
```

产物：`verify/dist/out-recolored.pptx`、`verify/shots/pp-*/slide-NN.png`、`verify/pp-report.json`

**注意**：probe 配置过滤掉了 `HtmlRspackPlugin`，而 `output.clean` 会把上次的
`index.html` 一起删掉。`run_recolor.py` 每次自己生成一个，不要指望仓库里存着。

## 检查清单

| 检查 | 判据 | 2026-11-26 实测 |
|---|---|---|
| 颜色确实换了 | 橙色系全部变成目标色相 | `FF6900`×323 → `006BFF`、`A34716`×127 → `165BA3` |
| 中性色没误伤 | 灰阶次数不变 | `333333`/`404040`/`D9DDE2` 次数完全一致 |
| 结构没动 | zip 条目数与条目名一致 | 150 → 150，名字集合相同 |
| XML 未损坏 | 全部部件可解析 | 150 个部件，0 畸形 |
| 能被 Office 打开 | LibreOffice 转 PDF 页数一致 | 源 11 页 → 产物 11 页 |
| 耗时 | 3.9 MB 应远低于 5 秒 | 1252 ms |
| **图片只改单色** | 多色 logo / 截图 / 照片字节不变 | 9 张里只改 1 张（橙色勾选图标） |
| **内嵌工作簿不变** | `ppt/embeddings/*.xlsx` 逐字节相同 | 7 个全部 SAME |
| **图表可编辑** | 真 PowerPoint 里 `ChartData.Workbook` 能加载 | 7/7 通过，数值逐个相同 |
| **超链接色不动** | theme 的 `hlink`/`folHlink` 保持原值 | 修后橙色残留 7 种 → 0 种 |

## 为什么需要 `run_artifact_assert.py`（负向断言）

M2.5 真机检查一次性暴露了三个自动化没抓到的问题，全部属于「**不该动的东西被动过**」：

| 症状 | 根因 |
|---|---|
| 白底截图 48% 像素被染色 | `saturationOf` 用 HSL 的 S，近白像素 `F9FBFF` 算出来是 **1.000**（HSV 只有 0.024），`minSaturation: 0.15` 的闸门在浅色区彻底失效 |
| 品牌 logo 红变青绿 | 色相平移是「所有颜色一起转」，多色 logo 必被毁 |
| 橙色永远是 7 种不是 0 种 | theme 的 `hlink`（灰蓝 193°）被平移成土褐（20°），撞进橙色判定区 |

**正向断言（「页数对、能打开」）永远抓不到这几类。** 必须显式写「这些字节必须不变」。
这个教训值得记住：**换色功能的测试重点不是「改对了什么」，而是「没改错什么」。**

## 注意

- 本机 Playwright 的 chromium 下载可能"假成功"，脚本显式指定系统 Edge。
- `python -I` 必要：临时目录里若有同名 `.py` 会劫持标准库导入（踩过 `bisect.py`）。
- 图片换色在真实文件上是保守的：9 张媒体里只改 1 张，多色 logo、截图、EMF、照片全部按设计跳过。
- **图片路径的饱和度判定必须用 HSV，XML 路径继续用 HSL** —— 两者需求相反：
  XML 里 `FFF2E8`（橙色浅底纹，HSV sat 0.09）跟着品牌色走是对的；
  图片里同样的近白色必须跳过，否则整张白底被染色。

