'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Camera, Download, Edit3, Plus, Trash2 } from 'lucide-react';
import type { DeckDTO, LearningItemDTO } from '../domain/types';
import { api, downloadJson, errorMessage, fetchAllItems, request } from '../lib/api-client';
import { parseEntryLines, type DraftEntry } from '../lib/ocr';
import { offlineStore } from '../lib/offline';
import { Button, EmptyState, Modal, PageTitle } from './ui';
import EntryEditor, { blankEntry } from './entry-editor';
import OcrPanel from './ocr-panel';

export default function DecksPanel({ userId, onStudy, onDetail, onMessage }: { userId: string; onStudy: (deckId: string) => void; onDetail: (item: LearningItemDTO) => void; onMessage: (message: string) => void }) {
  const [decks, setDecks] = useState<DeckDTO[]>([]); const [active, setActive] = useState<DeckDTO | null>(null); const [items, setItems] = useState<LearningItemDTO[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [modal, setModal] = useState<'create' | 'rename' | 'entry' | 'ocr' | null>(null);
  const [name, setName] = useState(''); const [category, setCategory] = useState(''); const [busy, setBusy] = useState(false); const [entries, setEntries] = useState<DraftEntry[]>([blankEntry()]); const [paste, setPaste] = useState(''); const [editing, setEditing] = useState<LearningItemDTO | null>(null); const [readyDraft, setReadyDraft] = useState(false);
  const activeId = active?.id;
  const load = useCallback(async () => {
    try { const data = await api.decks(); setError(''); setDecks(data.decks); if (activeId) { setItems((await fetchAllItems({ deckId: activeId })).items); const updated = data.decks.find(deck => deck.id === activeId); if (updated) setActive(updated); } } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, [activeId]);
  useEffect(() => {
    let current = true;
    void Promise.all([api.decks(), activeId ? fetchAllItems({ deckId: activeId }) : Promise.resolve(null)]).then(([data, content]) => {
      if (!current) return; setDecks(data.decks); setItems(content?.items || []); setError(''); setLoading(false);
      if (activeId) { const updated = data.decks.find(deck => deck.id === activeId); if (updated) setActive(updated); }
    }).catch(caught => { if (current) { setError(errorMessage(caught)); setLoading(false); } });
    return () => { current = false; };
  }, [activeId]);
  useEffect(() => {
    if (modal === 'entry' && active && !editing && readyDraft) void offlineStore.saveDraft(userId, `manual:${active.id}`, { entries, paste }).catch(() => {});
  }, [entries, paste, modal, active, editing, readyDraft, userId]);
  function openDeckModal(rename = false) { setName(rename ? active?.name || '' : ''); setCategory(rename ? active?.category || '' : ''); setModal(rename ? 'rename' : 'create'); }
  async function saveDeck(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await request<{ deck?: DeckDTO; id?: string; name?: string; category?: string }>(modal === 'rename' && active ? `/api/decks/${encodeURIComponent(active.id)}` : '/api/decks', { method: modal === 'rename' ? 'PATCH' : 'POST', body: JSON.stringify({ name, category }) });
      setModal(null); await load();
      const created = result.deck || (result.id ? { id: result.id, name, category, count: 0 } : null);
      if (created && modal === 'create') setActive(created);
      onMessage(modal === 'rename' ? '词库名称已更新。' : '新词库已创建，可以开始添加内容。');
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  async function deleteDeck() {
    if (!active || !window.confirm(`删除「${active.name}」这个集合？教材原词条及其他词库中的内容会保留。`)) return;
    try { await request(`/api/decks/${encodeURIComponent(active.id)}`, { method: 'DELETE' }); setActive(null); setItems([]); setDecks(current => current.filter(deck => deck.id !== active.id)); onMessage('词库已删除。'); } catch (caught) { setError(errorMessage(caught)); }
  }
  async function openEntry(item?: LearningItemDTO) {
    setReadyDraft(false); setEditing(item || null); setPaste('');
    if (item) setEntries([{ russian: item.russian, chinese: item.chinese, kind: item.kind, notes: item.notes, example: item.example || '', tags: item.tags || [] }]);
    else { const saved = await offlineStore.getDraft<{ entries: DraftEntry[]; paste: string }>(userId, `manual:${active!.id}`); setEntries(saved?.entries || [blankEntry()]); setPaste(saved?.paste || ''); }
    setReadyDraft(true); setModal('entry');
  }
  async function saveEntries() {
    if (!active || !entries.length || entries.some(entry => !entry.russian.trim())) return;
    setBusy(true); setError('');
    try {
      await request(editing ? `/api/decks/${encodeURIComponent(active.id)}/items/${encodeURIComponent(editing.id)}` : `/api/decks/${encodeURIComponent(active.id)}/items`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? entries[0] : { items: entries }) });
      if (!editing) await offlineStore.deleteDraft(userId, `manual:${active.id}`);
      setModal(null); await load(); onMessage(editing ? '内容已更新。' : `已保存 ${entries.length} 条内容。`);
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  async function deleteItem(item: LearningItemDTO) {
    if (!active || !window.confirm(`从这个词库移除「${item.russian}」？`)) return;
    try { await request(`/api/decks/${encodeURIComponent(active.id)}/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); await load(); } catch (caught) { setError(errorMessage(caught)); }
  }
  async function exportDeck() {
    if (!active || busy) return;
    setBusy(true); setError('');
    try {
      // Export a fresh server snapshot: the visible list may still be refreshing
      // after an edit, or may belong to a previously selected collection.
      const [catalog, content] = await Promise.all([api.decks(), fetchAllItems({ deckId: active.id })]);
      const deck = catalog.decks.find(candidate => candidate.id === active.id);
      if (!deck) throw new Error('这个词库已不存在，请刷新列表。');
      setItems(content.items); setActive(deck);
      downloadJson(`${deck.name}.json`, { name: deck.name, category: deck.category, items: content.items });
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  return <section>
    <PageTitle eyebrow="МОИ СЛОВА" title={active ? active.name : '把遇见的词，留下来。'} description={active ? `${active.category || '个人词库'} · ${active.count} 条内容` : '课本之外，也有属于你的俄语。'} action={!active ? <Button onClick={() => openDeckModal()}><Plus size={18} />新建词库</Button> : undefined} />
    {active ? <><div className="deck-toolbar"><Button variant="ghost" onClick={() => { setActive(null); setItems([]); }}><ArrowLeft size={17} />全部词库</Button><div className="toolbar-actions"><button className="icon-button" aria-label="重命名词库" onClick={() => openDeckModal(true)}><Edit3 size={18} /></button><button className="icon-button" aria-label="导出词库" disabled={busy || loading} onClick={() => void exportDeck()}><Download size={18} /></button><button className="icon-button danger-text" aria-label="删除词库" onClick={() => void deleteDeck()}><Trash2 size={18} /></button></div></div>
      <div className="deck-study-banner"><div><h2>你的词，你的节奏。</h2><p>单词、词组和句子，都能加入下一轮学习。</p></div><Button disabled={!items.some(item => !item.missingMeaning)} onClick={() => onStudy(active.id)}>开始学习<ArrowRight size={18} /></Button></div>
      <div className="toolbar"><Button variant="secondary" onClick={() => void openEntry()}><Plus size={18} />手动添加</Button><Button variant="secondary" onClick={() => setModal('ocr')}><Camera size={18} />从照片拾词</Button></div>
      {items.length ? <div className="word-list">{items.map(item => <div className="deck-word-row" key={item.id}><button className="word-row" onClick={() => onDetail(item)}><span className="word-text"><strong lang="ru">{item.russian}</strong><span>{item.missingMeaning ? '尚缺中文释义 · 补充后可练习' : item.chinese}</span><small>{item.kind === 'word' ? '单词' : item.kind === 'phrase' ? '词组' : '句子'}{item.sourceEntryId ? ' · 来自教材' : ''}</small></span></button><div className="word-edit-actions">{!item.sourceEntryId && <button className="icon-button" aria-label={`编辑 ${item.russian}`} onClick={() => void openEntry(item)}><Edit3 size={17} /></button>}<button className="icon-button danger-text" aria-label={`移除 ${item.russian}`} onClick={() => void deleteItem(item)}><Trash2 size={17} /></button></div></div>)}</div> : !loading && <EmptyState title="留住第一个词">手动添加，或拍一张词表照片。</EmptyState>}
    </> : <><div className="decks-grid">{decks.map((deck, index) => <button className={`deck-tile deck-color-${index % 3}`} onClick={() => setActive(deck)} key={deck.id}><BookOpen size={24} /><span className="deck-category">{deck.category || '个人积累'}</span><h2>{deck.name}</h2><div><span>{deck.count} 条内容</span><ArrowRight size={21} /></div></button>)}</div>{!loading && !decks.length && <EmptyState title="给你的俄语，留一个位置" action={<Button onClick={() => openDeckModal()}><Plus size={18} />创建第一个词库</Button>}>从一张照片、一个词或一句喜欢的话开始。</EmptyState>}<div className="personal-note"><Camera size={25} /><div><h3>书页上的词，也能走进词库。</h3><p>进入任意词库，拍照识别俄语和中文；核对、修改后再保存。</p></div></div></>}
    {loading && <p role="status" className="small muted">正在加载词库…</p>}{error && <p role="alert" className="notice notice-error">{error}</p>}
    {(modal === 'create' || modal === 'rename') && <Modal title={modal === 'create' ? '新建个人词库' : '编辑词库信息'} onClose={() => setModal(null)}><form onSubmit={event => void saveDeck(event)}><label>词库名称<input value={name} onChange={event => setName(event.target.value)} required maxLength={80} placeholder="例如：日常遇见的词" /></label><label>分类<input value={category} onChange={event => setCategory(event.target.value)} maxLength={40} placeholder="例如：生活、阅读、旅行" /></label><Button type="submit" busy={busy} className="full-width">保存词库</Button>{error && <p className="notice notice-error">{error}</p>}</form></Modal>}
    {modal === 'entry' && active && <Modal title={editing ? '编辑内容' : '添加到个人词库'} onClose={() => setModal(null)} wide>{!editing && <details className="paste-input"><summary>粘贴多行内容</summary><label>每行一条，用 Tab 或 | 分开俄文和中文<textarea rows={5} value={paste} onChange={event => setPaste(event.target.value)} placeholder={'книга | 书\nдоброе утро | 早上好'} /></label><Button variant="secondary" disabled={!paste.trim()} onClick={() => setEntries(parseEntryLines(paste))}>生成入库预览</Button></details>}<EntryEditor entries={entries} single={!!editing} onChange={value => setEntries(editing ? value.slice(0, 1) : value)} /><p className="small muted">请核对不同义项。空缺释义会标记为待补译，不进入双向选择题。</p><Button className="full-width" busy={busy} disabled={!entries.length || entries.some(entry => !entry.russian.trim())} onClick={() => void saveEntries()}>确认保存 {entries.length} 条</Button>{error && <p role="alert" className="notice notice-error">{error}</p>}</Modal>}
    {modal === 'ocr' && active && <OcrPanel userId={userId} deckId={active.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load(); onMessage('识别内容已保存，可以开始学习了。'); }} />}
  </section>;
}
