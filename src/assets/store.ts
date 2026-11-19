/**
 * 素材二进制存储（R10）：IndexedDB 存图片 dataURL 与元数据。
 *
 * 为什么用 IndexedDB：localStorage 配额约 5MB 且同步阻塞，图片二进制放那里
 * 会挤掉项目存档；IndexedDB 配额大（通常数百 MB）、异步、适合二进制/大字符串。
 *
 * 容量上限（执行方选定，已记入开发日志）：
 * - 单文件 5MB（原始文件大小）；
 * - 素材库总容量 50MB（全部素材原始大小之和）。
 * 超限给出友好中文提示，不写坏库。
 */

import type { AssetCrop } from './crop';

/** 素材记录（元数据 + dataURL；dataUrl 供渲染/缩略图/导出打包直接使用） */
export interface AssetRecord {
  id: string;
  name: string;
  /** MIME 类型（image/png | image/jpeg | image/webp） */
  type: string;
  /** 原始像素宽高（渲染适配与碰撞包围盒用） */
  width: number;
  height: number;
  /** 原始文件字节数（容量统计用） */
  size: number;
  dataUrl: string;
  createdAt: string;
  /** 裁剪参数（R16，可选：缺省 = 完整显示 fit）。dataUrl 恒为原图，
   *  显示图由 derive.ts 按参数推导——再次调整永远基于原图，无累积损失。
   *  注意：R22 独立裁剪素材（cropResult=true）不携带本字段。 */
  crop?: AssetCrop;
  /** 独立裁剪结果标记（R22）：dataUrl 即最终像素（独立 ID/宽高），
   *  跳过 derive 推导；作背景时 contain 完整显示留白，禁止 cover 二次裁剪。 */
  cropResult?: boolean;
}

/** 单文件上限：5MB */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** 素材库总容量上限：50MB */
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const DB_NAME = 'qoder-sc-assets';
const DB_VERSION = 1;
const STORE = 'images';

let dbPromise: Promise<IDBDatabase> | null = null;

/** 打开（或创建）素材库；失败时清除缓存允许重试 */
function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(new Error('素材库不可用（浏览器存储受限）'));
    };
  });
  return dbPromise;
}

/** 通用事务封装：把 IDBRequest 包装为 Promise */
async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('素材库读写失败'));
  });
}

/** 列出全部素材（含 dataUrl；素材数量有限，整表读取开销可接受） */
export async function listAssets(): Promise<AssetRecord[]> {
  const all = await withStore('readonly', (s) => s.getAll() as IDBRequest<AssetRecord[]>);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 按 id 取素材 */
export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  return withStore('readonly', (s) => s.get(id) as IDBRequest<AssetRecord | undefined>);
}

/** 写入素材（同 id 覆盖；容量检查由导入方负责） */
export async function putAsset(rec: AssetRecord): Promise<void> {
  await withStore('readwrite', (s) => s.put(rec));
}

/** 删除素材 */
export async function deleteAsset(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}

/** 当前素材库总字节数（原始文件大小之和） */
export async function totalSize(): Promise<number> {
  const all = await listAssets();
  return all.reduce((sum, a) => sum + a.size, 0);
}