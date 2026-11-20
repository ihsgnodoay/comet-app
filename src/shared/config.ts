/**
 * 构建期配置。
 * 正式桌面应用不使用虚拟串口：测试夹具仅保留在源码层，
 * 由 scripts/smoke-test.js 直接 require，不参与主进程运行时、不打入安装包。
 */
/** settings.json 结构版本，用于清理开发期遗留的虚拟串口配置 */
export const SETTINGS_VERSION = 2;
