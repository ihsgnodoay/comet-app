/**
 * 构建期开关。
 * 正式桌面应用不使用虚拟串口；MockSerial 仅保留为无窗口冒烟测试夹具
 * （COMET_SMOKE=1 时由主进程临时启用，不写入用户配置）。
 */
export const ALLOW_MOCK = false;

/** settings.json 结构版本，用于清理开发期遗留的虚拟串口配置 */
export const SETTINGS_VERSION = 2;
