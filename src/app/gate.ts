/**
 * 访问口令门。
 *
 * ⚠️ 这是**威慑**，不是安全边界：
 * 纯静态站点的一切都必须发到浏览器，因此任何前端口令都能被读懂逻辑的人绕过。
 * 它挡住的是「拿到网址随手打开就想用」的人，不是有备而来的人。
 *
 * 真正的保护来自两件事，与本文件无关：
 * 1. API Key 只存在各人自己的浏览器 localStorage，不在构建产物里
 * 2. 网址不公开、不写进任何索引
 *
 * 存哈希而非明文，是为了让它在源码里不可直接读出。
 */

/** 构建期注入；留空表示不启用口令门 */
declare const __ACCESS_PASSWORD_HASH__: string

const STORAGE_KEY = 'app:gate-passed'
/** 口令校验通过后写入的标记；改口令后这个版本号要一起改，才会让旧标记失效 */
const GATE_VERSION = 'v1'

/** 未配置口令时不启用 */
export const isGateEnabled = (): boolean =>
  typeof __ACCESS_PASSWORD_HASH__ === 'string' && __ACCESS_PASSWORD_HASH__.trim() !== ''

/** 十六进制小写 SHA-256 */
const sha256 = async (input: string): Promise<string> => {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** 本机是否已经通过口令校验 */
export const hasPassedGate = (): boolean => {
  if (!isGateEnabled()) {
    return true
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === GATE_VERSION
  } catch {
    // 存储不可用（隐私模式）时每次都要求输入，宁可麻烦也不放行
    return false
  }
}

/** 校验口令；成功则记住本机已通过 */
export const tryPassGate = async (input: string): Promise<boolean> => {
  const expected = __ACCESS_PASSWORD_HASH__.trim().toLowerCase()
  const actual = await sha256(input.trim())
  if (actual !== expected) {
    return false
  }
  try {
    localStorage.setItem(STORAGE_KEY, GATE_VERSION)
  } catch {
    // 存不下也不影响本次使用
  }
  return true
}
