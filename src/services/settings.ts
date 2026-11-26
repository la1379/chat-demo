import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import type { ProviderId } from './api/providers.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  /** 当前服务商；换服务商需要重填对应 Key */
  provider: ProviderId
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  /** 旧版单一 Key；只在迁移时读，新数据按服务商分开存 */
  apiKeyLegacy: 'chat-demo:api-key',
  /** 按服务商分开存：prefix + providerId */
  apiKeyPrefix: 'chat-demo:api-key:',
  provider: 'chat-demo:provider',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 当前服务商对应的 Key 存储键 */
const apiKeyOf = (provider: ProviderId): string => `${KEYS.apiKeyPrefix}${provider}`

const readApiKey = (provider: ProviderId): string | null => read(apiKeyOf(provider))

/**
 * 迁移旧版的单一 Key。
 *
 * 旧数据只有一个 chat-demo:api-key，不知道属于哪家。按「当前选中的服务商」
 * 迁过去是最合理的推断 —— 用户填它的时候用的就是当前这家。
 * 迁完删掉旧键，避免下次又迁一遍。
 */
const migrateLegacyApiKey = (provider: ProviderId): string | null => {
  const legacy = read(KEYS.apiKeyLegacy)
  if (!legacy) {
    return null
  }
  write(apiKeyOf(provider), legacy)
  write(KEYS.apiKeyLegacy, null)
  return legacy
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialProvider = (): ProviderId => {
  const saved = read(KEYS.provider) as ProviderId | null
  return saved === 'bailian' ? 'bailian' : 'deepseek'
}

const providerAtBoot = initialProvider()

export const useSettings = create<Settings>(() => ({
  apiKey: readApiKey(providerAtBoot) ?? migrateLegacyApiKey(providerAtBoot),
  provider: providerAtBoot,
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(apiKeyOf(useSettings.getState().provider), apiKey)
  useSettings.setState({ apiKey })
}

/**
 * 换服务商。
 *
 * 两家的 Key 分开存，切换只是换用哪一份 —— 不会出现「拿 A 家的 Key 打 B 家」
 * 这种最难查的状态，也不用逼用户重填。每家填过一次就一直记得。
 */
export const setProvider = (provider: ProviderId) => {
  if (useSettings.getState().provider === provider) {
    return
  }
  write(KEYS.provider, provider)
  useSettings.setState({ provider, apiKey: readApiKey(provider) })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
