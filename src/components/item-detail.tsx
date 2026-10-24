'use client';
/* eslint-disable @next/next/no-img-element -- Source thumbnails require session cookies and must not enter a shared image optimizer cache. */

import { useEffect, useState } from 'react';
import { Bookmark, Check, ExternalLink, ImageIcon, Pause, Plus, Play } from 'lucide-react';
import type { DeckDTO, EvidenceField, LearningItemDTO } from '../domain/types';
import { api, request, errorMessage } from '../lib/api-client';
import { Button, Modal, SpeechButton } from './ui';

const labels: Record<string, string> = { headword: '规范词头', stress: '重音', stressedForm: '重音', partOfSpeech: '词性', aspect: '动词体', aspectPartners: '体对应', conjugation: '变位', conjugationType: '变位类型', declension: '六格变化', gender: '性', animacy: '生命性', number: '数', government: '接格', collocations: '固定搭配', relatedWords: '关联词', examples: '例句', example: '例句', commonErrors: '常见错误', register: '语体', meaning: '教材义项', source: '来源', notes: '用法说明', forms: '词形', synonyms: '近义词', antonyms: '反义词', reflexive: '反身性', transitivity: '及物性', present: '现在时', future: '将来时', past: '过去时', imperative: '命令式', rootRelations: '同根词', pronunciation: '发音', entryType: '内容类型', sourceMorphology: '教材词性与词形', morphologyCandidates: '形态分析候选', aspectPairs: '体对应关系', phraseUsage: '词组用法', sentenceAnalysis: '句子分析', usageNotes: '用法与核查说明', provenance: '来源定位记录', russian: '俄语', chinese: '中文', origin: '说明', input: '原词', candidates: '候选结果', form: '词形', lemma: '词元', tag: '语法标签', dictionaryKnown: '词典收录', score: '匹配评分', category: '词类', indeclinable: '不变格', singularOnly: '仅单数', pluralOnly: '仅复数', rows: '各格词形', case: '格', label: '名称', singular: '单数', plural: '复数', note: '说明', tense: '时态', tenseLabel: '时态', finite: '人称形式', person: '人称', pastPlural: '过去时复数', conjugationClass: '变位类型', sourceKey: '来源条目标识', rowNumber: '原表行号', book: '册数', lessons: '课次', documentId: '来源文档', assetIds: '原图编号', bookPage: '书内页码', pdfPage: '来源 PDF 页码', originalLinkFormula: '原表定位公式', members: '对应成员', relation: '关系', limitation: '限制', scope: '适用范围', evidence: '依据', raw: '原文', rawText: '原文', structure: '结构', target: '目标', status: '状态', constraints: '限制', sourceAspect: '原表体标注' };
const values: Record<string, string> = { word: '单词', phrase: '词组', sentence: '句子', noun: '名词', adjective: '形容词', verb: '动词', perf: '完成体', impf: '未完成体', biasp: '双体', masc: '阳性', femn: '阴性', neut: '中性', anim: '有生命', inan: '无生命', sing: '单数', plur: '复数', '1per': '第一人称', '2per': '第二人称', '3per': '第三人称', pres: '现在时', futr: '将来时', tran: '及物', intr: '不及物', nomn: '主格', gent: '属格', datv: '与格', accs: '宾格', ablt: '工具格', loct: '前置格' };
const methods: Record<string, string> = { 'verbatim-workbook-cell': '保留教材单元格原文', 'verbatim-workbook-note': '保留教材备注', 'retain-explicit-source-stress-only': '仅保留原文明确标注的重音', 'dictionary-parse-and-exact-lexeme-enumeration': '词典分析与词形枚举，结果仍需核查', 'Codex-authored-teaching-draft; not human reviewed': '教学示例草稿，未经人工审核', 'immutable-source-mapping': '保留原始来源映射', 'explicit-50-item-editorial-selection': '代表性内容分类，待核查', 'explicit-selection': '代表性内容分类，待核查', 'unresolved-source-pair': '原表对应关系尚未确认', 'explicit-pair-selection-plus-source-aspect-labels': '结合原表标注整理，待核查', 'retain-source-dictionary-conflict; no automatic correction': '保留原表与词典差异，不自动改写', 'verbatim-government-markers': '保留原表接格标记', 'source-sentence-as-example': '原文句子作为示例', 'No etymology/synonym relation inferred from spelling or prefixes': '没有仅凭拼写或前缀推断词源与关联', 'Do not create one inflection table for an entire phrase/sentence': '词组与句子不使用单一变格表' };
function sourceLabel(source: string) {
  if (source.startsWith('workbook:')) return `教材工作簿 · ${source.split('#')[1]?.split(';').filter((_, index) => index !== 1).join(' · ') || '原词表'}`;
  if (source.startsWith('project:')) return '项目教学示例，待核查';
  if (source.startsWith('OpenCorpora')) return 'OpenCorpora 俄语形态词典 · CC BY-SA 3.0';
  return source;
}
const statusLabels: Record<EvidenceField['status'], string> = { source: '有来源', generated: '候选说明 · 待核查', reviewed: '已审核', unknown: '尚缺资料', disputed: '有争议 · 待核查', 'not-applicable': '不适用', rejected: '审核未通过 · 保留原值' };
function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span className="muted">尚缺资料</span>;
  if (Array.isArray(value)) return <ul className="annotation-list">{value.map((child, index) => <li key={index}><Value value={child} /></li>)}</ul>;
  if (typeof value === 'object') {
    const data = value as Record<string, unknown>;
    if (Array.isArray(data.rows)) return <div className="grammar-block"><p className="grammar-caption"><span lang="ru">{String(data.lemma || '')}</span>{data.gender ? ` · ${values[String(data.gender)] || data.gender}` : ''}{data.animacy ? ` · ${values[String(data.animacy)] || data.animacy}` : ''}{data.indeclinable ? ' · 不变格' : ''}</p><div className="grammar-table-wrap"><table className="grammar-table"><thead><tr><th>格</th><th>单数</th><th>复数</th></tr></thead><tbody>{data.rows.map((raw, index) => { const row = raw as Record<string, unknown>; return <tr key={index}><th>{String(row.label || values[String(row.case)] || row.case || '')}</th><td lang="ru"><Value value={row.singular} /></td><td lang="ru"><Value value={row.plural} /></td></tr>; })}</tbody></table></div>{Boolean(data.note) && <p className="small muted">{String(data.note)}</p>}</div>;
    if (Array.isArray(data.finite)) return <div className="grammar-block"><p className="grammar-caption"><span lang="ru">{String(data.lemma || '')}</span> · {values[String(data.aspect)] || String(data.aspect || '体待核查')} · {String(data.tenseLabel || values[String(data.tense)] || '')}</p><div className="grammar-table-wrap"><table className="grammar-table"><thead><tr><th>人称与数</th><th>词形</th></tr></thead><tbody>{data.finite.map((raw, index) => { const row = raw as Record<string, unknown>; return <tr key={index}><th>{values[String(row.number)]} · {values[String(row.person)]}</th><td lang="ru"><Value value={row.forms} /></td></tr>; })}</tbody></table></div><dl className="annotation-values">{['past', 'pastPlural', 'imperative', 'transitivity', 'reflexive', 'conjugationClass'].filter(key => key in data).map(key => <div key={key}><dt>{labels[key]}</dt><dd><Value value={data[key]} /></dd></div>)}</dl>{Boolean(data.note) && <p className="small muted">{String(data.note)}</p>}</div>;
    return <dl className="annotation-values">{Object.entries(data).map(([key, child]) => <div key={key}><dt>{labels[key] || values[key] || key}</dt><dd><Value value={child} /></dd></div>)}</dl>;
  }
  if (typeof value === 'boolean') return <span>{value ? '是' : '否'}</span>;
  return <span lang={typeof value === 'string' && /[а-яё]/iu.test(value) ? 'ru' : undefined}>{values[String(value)] || String(value)}</span>;
}
export { Value as AnnotationValue, labels as annotationFieldLabels, methods as annotationMethodLabels, sourceLabel as annotationSourceLabel };
export default function ItemDetail({ initial, onClose, onMessage, onChanged }: { initial: LearningItemDTO; onClose: () => void; onMessage: (message: string) => void; onChanged: () => void }) {
  const [item, setItem] = useState(initial); const [error, setError] = useState(''); const [sources, setSources] = useState(false); const [decks, setDecks] = useState<DeckDTO[]>([]); const [deckId, setDeckId] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api.item(initial.id).then(data => { if (active) setItem(data.item); }).catch(caught => { if (active && navigator.onLine) setError(errorMessage(caught)); });
    void api.decks().then(data => { if (active) setDecks(data.decks); }).catch(() => {});
    return () => { active = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); };
  }, [initial.id]);
  async function toggle(kind: 'favorite' | 'suspend') {
    setBusy(true); setError('');
    try {
      const result = await request<{ favorite?: boolean; suspended?: boolean }>(`/api/items/${encodeURIComponent(item.id)}/${kind}`, { method: 'POST' });
      setItem(current => ({ ...current, ...result })); onChanged();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  async function addToDeck() {
    if (!deckId) return; setBusy(true);
    try { await request(`/api/decks/${encodeURIComponent(deckId)}/items`, { method: 'POST', body: JSON.stringify({ existingItemIds: [item.id], items: [] }) }); onMessage('已加入个人词库，原教材词条会继续保留。'); onChanged(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  const annotations = item.annotations ? Object.entries(item.annotations) : [];
  return <Modal title="词条详情" onClose={onClose} wide>
    <div className="detail-word"><p className="eyebrow">{item.kind === 'phrase' ? '词组' : item.kind === 'sentence' ? '句子' : '单词'}{item.book ? ` · 第 ${item.book} 册 / 第 ${item.lessons.join('、')} 课` : ' · 个人词库'}</p><div><h2 lang="ru" className="russian">{item.russian}</h2><SpeechButton text={item.russian} onMessage={onMessage} /></div><p>{item.missingMeaning ? '原表尚未提供中文释义' : item.chinese}</p>{item.morphology && <span className="tag">{item.morphology}</span>}</div>
    {(item.missingMeaning || item.disputed) && <p className="notice notice-warning">{item.missingMeaning ? '中文释义缺失，暂不进入双向选择题。' : '原资料存在待核查项，相关争议内容不作为练习答案。'} 原文和来源仍可查看。</p>}
    <div className="detail-actions"><Button variant="secondary" busy={busy} onClick={() => void toggle('favorite')}>{item.favorite ? <Check size={17} /> : <Bookmark size={17} />}{item.favorite ? '已收藏' : '收藏'}</Button><Button variant="ghost" busy={busy} onClick={() => void toggle('suspend')}>{item.suspended ? <Play size={17} /> : <Pause size={17} />}{item.suspended ? '恢复学习' : '暂停此词'}</Button></div>
    {item.notes && <div className="source-note"><h3>原表备注</h3><p>{item.notes}</p></div>}
    {item.example && <section className="annotation"><h3>例句与备注</h3><p>{item.example}</p></section>}
    <section className="detail-annotations"><div className="section-heading"><h3>词语注解</h3><span className="small muted">按适用性与来源展示</span></div>{annotations.length ? annotations.map(([key, field]) => <details key={key} className="annotation" open={['meaning', 'aspect', 'examples', 'government', 'partOfSpeech', 'headword'].includes(key)}><summary><span>{labels[key] || key}</span><span className={`tag tag-${field.status}`}>{statusLabels[field.status] || field.status}</span></summary><div className="annotation-content"><Value value={field.status === 'not-applicable' ? '此词类不适用。' : field.value} />{field.source && <p className="evidence-source">依据：{sourceLabel(field.source)}</p>}{field.method && <p className="evidence-source">整理方式：{methods[field.method] || '按来源整理，保留核查状态'}</p>}</div></details>) : <p className="notice">此词已保留教材内容与原页。重音、词形、接格、关联词和例句尚待补充，不以猜测填充。</p>}</section>
    {item.sourceEntryId && <section className="source-section"><div className="section-heading"><h3>回到原文</h3><Button variant="ghost" onClick={() => setSources(!sources)}><ImageIcon size={17} />{sources ? '收起原页' : '查看原页'}</Button></div><p className="small muted">来源文档：{item.documentId}。书内页 {item.bookPage || '未标注'}；来源 PDF 页 {item.pdfPage || '未标注'}。</p>{item.book === 3 && <p className="small muted">第 3 册 PDF 页码属于 17 页词表摘录，不是完整版教材页码。</p>}{sources && <div className="source-images">{item.assetIds.length ? item.assetIds.map(id => <a key={id} href={`/api/assets/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer" className="source-image-link"><img src={`/api/assets/${encodeURIComponent(id)}?thumbnail=1`} alt={`${item.russian} 的原词表页`} /><span>打开原图<ExternalLink size={15} /></span></a>) : <p className="notice notice-warning">该条目的图片映射尚不可用，请查看数据质量报告。</p>}</div>}</section>}
    {decks.length > 0 && <div className="add-to-deck"><label>加入个人词库<select value={deckId} onChange={event => setDeckId(event.target.value)}><option value="">选择词库</option>{decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label><Button variant="secondary" disabled={!deckId} busy={busy} onClick={() => void addToDeck()}><Plus size={18} />加入</Button></div>}
    {error && <p role="alert" className="notice notice-error">{error}</p>}
  </Modal>;
}
