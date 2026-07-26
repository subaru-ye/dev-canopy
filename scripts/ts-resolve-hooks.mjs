// src 代码按 bundler 约定使用无扩展名相对导入(electron-vite 解析),
// Node 直跑测试时靠这个钩子把 './process-detection' 补成 './process-detection.ts'。
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../')
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier)
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && isRelative && !hasExtension) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw error
  }
}
