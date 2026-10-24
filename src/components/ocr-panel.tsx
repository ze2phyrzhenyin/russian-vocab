'use client';
/* eslint-disable @next/next/no-img-element -- User photos remain local data URLs; they are never sent to an image optimization service. */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Camera, Check, Crop, RotateCw, ScanText, Upload, X } from 'lucide-react';
import { defaultTransform, imageDataUrl, parseEntryLines, recognizeRussianChinese, transformImage, type DraftEntry, type ImageTransform, type OcrResult } from '../lib/ocr';
import { offlineStore } from '../lib/offline';
import { request, errorMessage } from '../lib/api-client';
import { Button, Modal } from './ui';
import EntryEditor from './entry-editor';

interface OcrDraft { source: string; prepared: string; transform: ImageTransform; text: string; entries: DraftEntry[]; result: OcrResult | null }
const emptyDraft: OcrDraft = { source: '', prepared: '', transform: defaultTransform, text: '', entries: [], result: null };
const progressNames: Record<string, string> = { 'loading tesseract core': '加载识别引擎', 'initializing tesseract': '启动识别引擎', 'loading language traineddata': '加载俄语与中文模型', 'initializing api': '准备识别', 'recognizing text': '识别文字' };
export default function OcrPanel({ userId, deckId, onClose, onSaved }: { userId: string; deckId: string; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<OcrDraft>(emptyDraft); const [ready, setReady] = useState(false); const [working, setWorking] = useState(false); const [saving, setSaving] = useState(false); const [progress, setProgress] = useState(0); const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [confirmed, setConfirmed] = useState(false);
  const job = useRef<ReturnType<typeof recognizeRussianChinese> | null>(null); const active = useRef(true);
  const key = `ocr:${deckId}`;
  useEffect(() => {
    active.current = true;
    void offlineStore.getDraft<OcrDraft>(userId, key).then(saved => { if (active.current) { if (saved) setDraft(saved); setReady(true); } }).catch(caught => { setError(errorMessage(caught)); setReady(true); });
    return () => { active.current = false; job.current?.cancel(); };
  }, [userId, key]);
  useEffect(() => { if (ready) void offlineStore.saveDraft(userId, key, draft).catch(caught => setError(errorMessage(caught))); }, [draft, ready, userId, key]);
  function update(patch: Partial<OcrDraft>) { setDraft(current => ({ ...current, ...patch })); setConfirmed(false); }
  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return; setError('');
    try { const source = await imageDataUrl(file); const prepared = await transformImage(source, defaultTransform); update({ ...emptyDraft, source, prepared }); } catch (caught) { setError(errorMessage(caught)); }
    event.target.value = '';
  }
  async function transform(next: ImageTransform) {
    setError('');
    try { update({ transform: next, prepared: await transformImage(draft.source, next) }); } catch (caught) { setError(errorMessage(caught)); }
  }
  async function recognize() {
    if (!draft.prepared || working) return; setWorking(true); setError(''); setProgress(0); setStatus('准备识别');
    job.current = recognizeRussianChinese(draft.prepared, (value, description) => { if (active.current) { setProgress(Math.round(value * 100)); setStatus(progressNames[description] || '正在准备识别'); } });
    try { const result = await job.current.result; if (active.current) { update({ result, text: result.text, entries: parseEntryLines(result.text) }); if (!result.text.trim()) setError('图片中没有识别出文字。试试裁剪到词表区域，或换一张更清晰的照片。'); } }
    catch (caught) { if (active.current) setError(errorMessage(caught)); }
    finally { if (active.current) setWorking(false); job.current = null; }
  }
  async function save() {
    if (!confirmed || !draft.entries.length || draft.entries.some(entry => !entry.russian.trim())) return;
    setSaving(true); setError('');
    try { await request(`/api/decks/${encodeURIComponent(deckId)}/items`, { method: 'POST', body: JSON.stringify({ items: draft.entries, ocr: draft.result }) }); await offlineStore.deleteDraft(userId, key); onSaved(); }
    catch (caught) { setError(errorMessage(caught)); } finally { setSaving(false); }
  }
  const duplicates = draft.entries.filter((entry, index) => draft.entries.findIndex(other => other.russian.trim().normalize('NFC') === entry.russian.trim().normalize('NFC') && other.chinese.trim() === entry.chinese.trim()) !== index).length;
  return <Modal title="从照片拾词" onClose={onClose} wide>
    <p className="muted">照片在这台设备上识别。先核对文字与释义，再加入词库。</p><div className="ocr-steps"><span className="active">1 选择图片</span><span className={draft.source ? 'active' : ''}>2 识别与编辑</span><span className={draft.entries.length ? 'active' : ''}>3 确认入库</span></div>
    <div className="upload-actions"><label className="button button-secondary"><Camera size={18} />拍照<input className="sr-only" type="file" accept="image/*" capture="environment" onChange={event => void choose(event)} disabled={working} /></label><label className="button button-secondary"><Upload size={18} />从相册选择<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" onChange={event => void choose(event)} disabled={working} /></label></div>
    <p className="small muted">图片上限 15 MB。浏览器不支持的格式需转为 JPEG / PNG；不直接识别 PDF。</p>
    {draft.source && <><div className="ocr-image"><img src={draft.prepared || draft.source} alt="待识别图片，可与下方文字对照" /></div><div className="ocr-transform"><Button variant="ghost" disabled={working} onClick={() => void transform({ ...draft.transform, rotation: draft.transform.rotation + 90 })}><RotateCw size={17} />旋转 90°</Button><details><summary><Crop size={17} />裁剪词表区域</summary><div className="crop-fields">{[['cropLeft', '左边距'], ['cropTop', '上边距'], ['cropWidth', '宽度'], ['cropHeight', '高度']].map(([keyName, label]) => <label key={keyName}>{label} %<input type="number" min={keyName.includes('Width') || keyName.includes('Height') ? 5 : 0} max={100} value={draft.transform[keyName as keyof ImageTransform]} onChange={event => update({ transform: { ...draft.transform, [keyName]: Number(event.target.value) } })} /></label>)}</div><Button variant="secondary" disabled={working} onClick={() => void transform(draft.transform)}>应用裁剪</Button></details></div>
      {working ? <div className="ocr-progress" role="status"><p>{status} · {progress}%</p><progress value={progress} max={100} /><Button variant="ghost" onClick={() => { job.current?.cancel(); setWorking(false); setStatus('识别已取消'); }}><X size={17} />取消识别</Button></div> : <Button onClick={() => void recognize()}><ScanText size={18} />{draft.result ? '重新识别' : '开始识别'}</Button>}
    </>}
    {draft.result && <section className="ocr-result"><div className="section-heading"><h3>对照原图，修正文字</h3><span className="tag">引擎置信度 {Math.round(draft.result.confidence)}%</span></div><p className="small muted">置信度不代表词语正确率。请重点检查 ё / е、重音、分栏顺序和中俄配对。</p><label>识别文本（每行一条，可用 Tab 或 | 分开俄文和中文）<textarea rows={7} value={draft.text} onChange={event => update({ text: event.target.value })} /></label><Button variant="secondary" onClick={() => update({ entries: parseEntryLines(draft.text) })}>根据编辑文字重新分行</Button><details className="ocr-coordinates"><summary>查看原始识别位置（{draft.result.boxes.length} 个文本框）</summary><div>{draft.result.boxes.map((box, index) => <p className="small" key={index}>{box.text} · {Math.round(box.confidence)}% · ({box.bbox.x0}, {box.bbox.y0}) – ({box.bbox.x1}, {box.bbox.y1})</p>)}</div></details></section>}
    {draft.entries.length > 0 && <><h3>准备加入词库的内容</h3><p className="small muted">在编辑框里合并或拆分内容，并为每条选择类型。没有中文的条目可先保存，补译后再练习。</p><EntryEditor entries={draft.entries} onChange={entries => update({ entries })} />{duplicates > 0 && <p className="notice notice-warning">草稿中有 {duplicates} 条完全相同的俄文与释义，请核对重复项。不同义项可以保留。</p>}<label className="checkbox-label confirmation"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已核对条目与中俄配对，确认保存这 {draft.entries.length} 条。</label><Button className="full-width" disabled={!confirmed || draft.entries.some(entry => !entry.russian.trim())} busy={saving} onClick={() => void save()}><Check size={18} />确认加入词库</Button></>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}<p className="small muted">关闭窗口会保留当前账号的本机草稿。识别结果在你确认前不会进入词库。</p>
  </Modal>;
}
