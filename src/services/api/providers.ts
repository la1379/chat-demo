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
   * 协议：Anthropic Messages 兼容层，还是 OpenAI chat/completions 兼容层。
   *
   * 百炼两条都提供，但只有 OpenAI 那条允许浏览器跨域 ——
   * /apps/anthropic 的预检 OPTIONS 一律 403 且无 Access-Control-Allow-Origin。
   */
  protocol: 'anthropic' | 'openai'
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
  protocol: 'anthropic',
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
  protocol: 'openai',
  id: 'bailian',
  label: '阿里云百炼',
  // Anthropic 兼容层（/apps/anthropic）浏览器连不上：预检 OPTIONS 403、无 CORS 头。
  // OpenAI 兼容层实测 access-control-allow-origin: *，所以百炼走这条。
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  // 百炼直供的 DeepSeek，走券支付；-1017 是具体版本号
  models: ['deepseek-v4-flash-1017'],
  // 百炼的 /apps/anthropic 下没有 /models（实测 404），只能发一个最小请求来验
  // /compatible-mode/v1/models 有 CORS，可以用它免费验 Key
  verify: { kind: 'models', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models', header: 'bearer' },
  // OpenAI 兼容层没有 Files API，图片走 base64 内联（OpenAI 的 image_url + data URL）。
  // 只内联本轮；历史轮次的图片不重发。
  fileUpload: 'inline',
  balanceUrl: null,
  verified: false,
  notes: '百炼的 Anthropic 端点尚未端到端验证',
}

export const PROVIDERS: Provider[] = [DEEPSEEK, BAILIAN]

export const getProvider = (id: ProviderId): Provider =>
  PROVIDERS.find((provider) => provider.id === id) ?? DEEPSEEK
