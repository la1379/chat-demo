/**
 * 申请把本站的本地数据标记为「持久化」。
 *
 * 背景：浏览器把 localStorage / IndexedDB 当作可随时回收的缓存 ——
 * 磁盘紧张时有权直接清掉，用户的聊天记录和 API Key 就没了。
 * 调用一次 persist() 之后，这个站点获得豁免（多数浏览器不会弹窗，直接决定）。
 *
 * 注意这不是备份：清浏览器数据、换浏览器、换网址照样会丢。
 * 真正的备份手段只有「设置 → 导出所有历史」。
 *
 * 失败不报错也不提示：拿不到豁免不影响正常使用，只是少一层保护。
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  // 旧浏览器或非安全上下文（http）下没有这个 API
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false
  }
  try {
    // 已经有豁免就直接返回，避免每次启动重复申请
    if (navigator.storage.persisted && (await navigator.storage.persisted())) {
      return true
    }
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
