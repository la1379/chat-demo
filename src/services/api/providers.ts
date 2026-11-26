/**
 * 服务商配置。
 *
 * 这个项目走 Anthropic 的 Messages 协议。DeepSeek 官方和阿里云百炼都提供
 * 兼容层，所以「换服务商」主要是换 base URL 与模型名，不用重写消息层。
 *
 * 但配套接口各家不一致，必须逐个声明，否则会坏在很隐蔽的地方：
 * - 填 Key 时的校验接口（DeepSeek 有 /models，百炼没有 → 404）
 * - 附件上传（Files API 是 Anthropic 专有扩展，百炼大概率没有）
 * - 余额查询（只有 DeepSeek 有 /user/balance）
 *
 * 所以这里不是「一个 URL 列表」，而是「每家的能力清单」。
 */

export type ProviderId = 'deepseek' | 'bailian'

export type Provider = {
  id: ProviderId
  /** 界面显示名 */
  label: string
  /** Messages 接口的前缀；实际请求 `${baseUrl}/messages` */
  baseUrl: string
  /** 可选的模型，第一个为默认 */
  models: string[]
  /** 填 Key 时用来验证的路径（相对 baseUrl 的上一级，见 verifyPath） */
  verify:
    | { kind: 'models'; url: string; header: 'bearer' | 'x-api-key' }
    /** 该服务商没有校验接口时，用一个最小请求验，会产生极少量费用 */
    | { kind: 'probe'; model: string }
  /**
   * 附件上传方式。
   *
   * - 'anthropic-files'：走 Anthropic 的 Files API（/files 上传拿 file_id）
   * - 'inline'：不走 Files API，把图片以 base64 内联进消息
   * - 'unknown'：还没测出来，界面上别断言能用或不能用
   */
  fileUpload: 'anthropic-files' | 'inline' | 'unknown'
  /** 余额查询地址；没有就为 null，界面上不显示按钮 */
  balanceUrl: string | null
  /** 是否为已实测过的配置 */
  verified: boolean
  /** 界面上要给用户看的注意事项 */
  notes?: string
}

const DEEPSEEK: Provider = {
  id: 'deepseek',
  label: 'DeepSeek 官方',
  baseUrl: 'https://api.deepseek.com/anthropic/v1',
  models: ['deepseek-flash', 'deepseek-v4-pro'],
  verify: { kind: 'models', url: 'https://api.deepseek.com/models', header: 'bearer' },
  fileUpload: 'anthropic-files',
  balanceUrl: 'https://api.deepseek.com/user/balance',
  verified: true,
}

const BAILIAN: Provider = {
  id: 'bailian',
  label: '阿里云百炼',
  baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic/v1',
  // 百炼直供的 DeepSeek，走券支付；-1017 是具体版本号
  models: ['deepseek-v4-flash-1017'],
  // 百炼的 /apps/anthropic 下没有 /models（实测 404），只能发一个最小请求来验
  verify: { kind: 'probe', model: 'deepseek-v4-flash-1017' },
  // 百炼的 Anthropic 兼容层下没有 /files（实测 404），所以走 base64 内联。
  // 图片直接塞进消息体，不走 Files API；历史轮次的图片不重发，只内联本轮。
  fileUpload: 'inline',
  balanceUrl: null,
  verified: false,
  notes: '百炼的 Anthropic 端点尚未端到端验证',
}

export const PROVIDERS: Provider[] = [DEEPSEEK, BAILIAN]

export const getProvider = (id: ProviderId): Provider =>
  PROVIDERS.find((provider) => provider.id === id) ?? DEEPSEEK
