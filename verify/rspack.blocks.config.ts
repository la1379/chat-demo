/**
 * 验证用构建配置（不参与正式构建）。
 * 复用主配置，只换入口与输出目录。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { createConfig } from '../rspack.config.js'

// 本文件在 verify/ 下，仓库根是再上一层
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export default defineConfig(() => {
  const base = createConfig()
  return {
    ...base,
    mode: 'development',
    devtool: false,
    entry: './verify/blocks-entry.tsx',
    output: {
      ...base.output,
      path: path.resolve(root, 'verify/dist'),
      clean: true,
    },
    plugins: base.plugins?.filter((plugin) => plugin?.constructor?.name !== 'HtmlRspackPlugin'),
  }
})
