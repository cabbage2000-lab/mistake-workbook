import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { loadTask, updateTask } from './model.ts';
import type { Source } from './schema.ts';
export async function importImage(directory: string, file: string, options: { id: string; label?: string; rotate?: number; crop?: [number, number, number, number] }): Promise<Source> {
  const task = await loadTask(directory);
  if (task.sources.some(s => s.id === options.id)) throw new Error('来源 ID 已存在');
  if (!/\.(jpe?g|png|webp)$/i.test(file)) throw new Error('P0 只接受 JPEG、PNG、WebP；PDF/Word 请由宿主转为图片或文字');
  const bytes = await readFile(resolve(file));
  const meta = await sharp(bytes).metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format || '')) throw new Error('图片实际格式不受支持');
  const name = randomUUID(); await mkdir(join(directory, 'resources'), { recursive: true });
  const originalAsset = `resources/${name}-original${extname(file).toLowerCase()}`;
  const asset = `resources/${name}.png`;
  await copyFile(resolve(file), join(directory, originalAsset));
  // Bake phone EXIF orientation into pixels before optional user rotation/crop.
  const oriented = await sharp(bytes).autoOrient().toBuffer();
  let pipeline = sharp(oriented).rotate(options.rotate ?? 0);
  if (options.crop) { const [left, top, width, height] = options.crop; pipeline = pipeline.extract({ left, top, width, height }); }
  await pipeline.png().toFile(join(directory, asset));
  const source: Source = { id: options.id, type: 'image', label: options.label || file.split(/[\\/]/).at(-1)!, asset, originalAsset, status: 'pending', coverage: 'unchecked', scopeConfirmed: false };
  await updateTask(directory, { expectedRevision: task.revision, operations: [{ op: 'addSource', source }] }); return source;
}
