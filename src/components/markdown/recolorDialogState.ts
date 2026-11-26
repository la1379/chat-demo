import { create } from 'zustand'

/**
 * 改配色弹窗的开合状态。
 *
 * 为什么要有一条不经对话的入口：改配色是纯前端像素与 XML 运算，整个过程
 * 不调用任何模型。如果只能由对话里的一段代码块触发，等于把一个不需要 AI 的
 * 功能绑在 API Key 上 —— 没 Key、断网、余额不足都用不了。所以主入口必须独立。
 */
export const useRecolorDialog = create(() => ({ open: false }))

export const openRecolorDialog = () => useRecolorDialog.setState({ open: true })

export const closeRecolorDialog = () => useRecolorDialog.setState({ open: false })
