/**
 * 配置持久化：主题、字体、串口参数、设备列表、快捷指令、面板状态。
 * 存到 Electron userData/settings.json，原子写（tmp + rename）避免写一半掉电损坏。
 *
 * 正式桌面应用强制禁用虚拟串口，并对开发期遗留配置做一次性迁移：
 * 旧 settings.json 里保存过 mockEnabled:true 和 4 台虚构设备，
 * 只改默认值会被旧文件覆盖，所以按 configVersion 清理一次并写回。
 */
import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { SETTINGS_VERSION } from '../shared/config';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = merge(out[k], v);
    else if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export class SettingsStore {
  private readonly file: string;
  private data: Settings;

  constructor() {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'settings.json');
    this.data = clone(DEFAULT_SETTINGS);
    this.read();
  }

  get(): Settings {
    return clone(this.data);
  }

  set(patch: Partial<Settings>): Settings {
    this.data = merge(this.data, patch);
    this.sanitize();
    this.write();
    return this.get();
  }

  get path(): string {
    return this.file;
  }

  /** mockEnabled 是历史字段，仅用于迁移兼容；任何写入路径都强制归零 */
  private sanitize(): void {
    this.data.mockEnabled = false;
    this.data.configVersion = SETTINGS_VERSION;
  }

  private read(): void {
    let loaded = clone(DEFAULT_SETTINGS);
    let dirty = true;
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, unknown>;
        const ver = typeof raw.configVersion === 'number' ? raw.configVersion : 0;
        loaded = merge(loaded, raw);
        dirty = ver < SETTINGS_VERSION;
        if (dirty) {
          loaded.mockEnabled = false;
          loaded.devices = [];
          console.log('[settings] 迁移配置 → v' + SETTINGS_VERSION + '（已清除虚拟串口配置与旧版自动生成的设备列表）');
        }
      }
    } catch (err) {
      console.error('[settings] 读取失败，回退默认值:', err);
    }
    this.data = loaded;
    this.sanitize();
    if (dirty) this.write();
  }

  private write(): void {
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[settings] 写入失败:', err);
    }
  }
}
