import type { Worker } from 'tesseract.js';

export interface OcrBox { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
export interface OcrResult { text: string; confidence: number; boxes: OcrBox[]; engine: string; recognizedAt: string }
export interface ImageTransform { rotation: number; cropLeft: number; cropTop: number; cropWidth: number; cropHeight: number }
export const defaultTransform: ImageTransform = { rotation: 0, cropLeft: 0, cropTop: 0, cropWidth: 100, cropHeight: 100 };

export async function imageDataUrl(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('图片超过 15 MB，请选择较小的照片。');
  if (file.type === 'application/pdf') throw new Error('此入口识别图片。请先把 PDF 页面转换为 PNG 或 JPEG。');
  if (!file.type.startsWith('image/')) throw new Error('请选择 PNG、JPEG 或浏览器支持的图片。');
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片无法读取，请重新选择。')); reader.readAsDataURL(file); });
}
export async function transformImage(source: string, transform: ImageTransform): Promise<string> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('浏览器无法解码这张图片。请转换为 JPEG 或 PNG 后重试。')); image.src = source; });
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片尺寸过大，请裁剪或缩小到 4000 万像素以内后重试。');
  const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale)); const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const rotated = document.createElement('canvas'); const quarter = ((transform.rotation % 360) + 360) % 360;
  rotated.width = quarter === 90 || quarter === 270 ? height : width; rotated.height = quarter === 90 || quarter === 270 ? width : height;
  const context = rotated.getContext('2d'); if (!context) throw new Error('浏览器不支持图片处理。');
  context.fillStyle = 'white'; context.fillRect(0, 0, rotated.width, rotated.height); context.translate(rotated.width / 2, rotated.height / 2); context.rotate(quarter * Math.PI / 180); context.drawImage(image, -width / 2, -height / 2, width, height);
  const left = Math.max(0, Math.min(95, transform.cropLeft)); const top = Math.max(0, Math.min(95, transform.cropTop));
  const cropWidth = Math.max(5, Math.min(100 - left, transform.cropWidth)); const cropHeight = Math.max(5, Math.min(100 - top, transform.cropHeight));
  const cropped = document.createElement('canvas'); cropped.width = Math.max(1, Math.round(rotated.width * cropWidth / 100)); cropped.height = Math.max(1, Math.round(rotated.height * cropHeight / 100));
  const target = cropped.getContext('2d'); if (!target) throw new Error('浏览器不支持图片处理。');
  target.drawImage(rotated, rotated.width * left / 100, rotated.height * top / 100, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped.toDataURL('image/png');
}

export function recognizeRussianChinese(source: string, onProgress: (progress: number, status: string) => void): { result: Promise<OcrResult>; cancel: () => void } {
  let worker: Worker | null = null; let cancelled = false;
  let rejectCancellation: (reason: Error) => void = () => {};
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const work = (async () => {
    const { createWorker } = await import('tesseract.js');
    if (cancelled) throw new Error('识别已取消，图片与草稿仍保留。');
    worker = await createWorker(['rus', 'chi_sim'], 1, {
      workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang', workerBlobURL: false,
      logger: event => { if (!cancelled) onProgress(event.progress ?? 0, event.status); },
    });
    if (cancelled) { await worker.terminate(); throw new Error('识别已取消，图片与草稿仍保留。'); }
    try {
      const { data } = await worker.recognize(source, {}, { text: true, blocks: true, tsv: true });
      const boxes: OcrBox[] = [];
      for (const block of data.blocks ?? []) for (const paragraph of block.paragraphs ?? []) for (const line of paragraph.lines ?? []) for (const word of line.words ?? []) boxes.push({ text: word.text, confidence: word.confidence, bbox: word.bbox });
      return { text: data.text, confidence: data.confidence, boxes, engine: 'tesseract.js@7.0.0/rus+chi_sim', recognizedAt: new Date().toISOString() };
    } finally { await worker?.terminate().catch(() => {}); worker = null; }
  })();
  return { result: Promise.race([work, cancellation]), cancel() { cancelled = true; rejectCancellation(new Error('识别已取消，图片与草稿仍保留。')); if (worker) void worker.terminate().catch(() => {}); } };
}

export interface DraftEntry { russian: string; chinese: string; kind: 'word' | 'phrase' | 'sentence'; notes: string; example: string; tags: string[] }
export function parseEntryLines(text: string): DraftEntry[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const parts = line.split(/\t|\s*[|｜]\s*/);
    if (parts.length >= 2) return { russian: parts[0].trim(), chinese: parts.slice(1).join(' ').trim(), kind: 'word', notes: '', example: '', tags: [] };
    const firstChinese = line.search(/[\u3400-\u9FFF]/);
    if (firstChinese > 0) return { russian: line.slice(0, firstChinese).trim().replace(/[-—:：]+$/, '').trim(), chinese: line.slice(firstChinese).trim(), kind: 'word', notes: '', example: '', tags: [] };
    return { russian: line, chinese: '', kind: 'word', notes: '', example: '', tags: [] };
  });
}
