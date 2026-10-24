'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Download, History, Pause, Play, RefreshCw, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { ANNOTATION_KEYS, CONTENT_PARTS_OF_SPEECH, type AnnotationKey, type AnnotationMutationResult, type AnnotationRevisionDTO, type ContentCoverageDTO, type ContentItemDetail, type ContentJobDetail, type ContentJobDTO, type ContentListResponse, type CreateContentJobInput, type ReviewAnnotationInput, type RollbackAnnotationInput } from '../domain/content';
import type { EvidenceField } from '../domain/types';
import { ApiError, downloadJson, errorMessage, request } from '../lib/api-client';
import { AnnotationValue, annotationFieldLabels, annotationMethodLabels, annotationSourceLabel } from './item-detail';
import { Button, EmptyState, Modal } from './ui';

const base = '/api/admin/content';
const statusLabels: Record<string, string> = { source: '有来源', generated: '自动草稿', reviewed: '已审核', unknown: '尚缺资料', disputed: '有争议', 'not-applicable': '不适用', rejected: '审核未通过', missing: '尚未整理', queued: '等待处理', running: '处理中', completed: '已完成', 'completed-with-errors': '完成 · 有失败项', cancelled: '已取消' };
const partLabels: Record<string, string> = { noun: '名词', adjective: '形容词', verb: '动词', adverb: '副词', pronoun: '代词', numeral: '数词', preposition: '前置词', conjunction: '连接词', particle: '语气词', interjection: '感叹词', participle: '形动词', gerund: '副动词', predicative: '述谓词', phrase: '词组', sentence: '句子', ambiguous: '存在多种分析', unknown: '尚未确定' };
const fieldLabel = (key: string) => annotationFieldLabels[key] || key;
const dateLabel = (value: string) => new Date(value).toLocaleString('zh-CN');
const percent = (count: number, total: number) => total ? `${(count / total * 100).toFixed(1)}%` : '—';

function Status({ value }: { value: string }) { return <span className={`workbench-status is-${value}`}>{statusLabels[value] || value}</span>; }
function useResource<T>(url: string, pollMs = 0) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ url: string; revision: number; value: T | null; error: string }>({ url: '', revision: -1, value: null, error: '' });
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void request<T>(url, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setResult({ url, revision, value, error: '' }); }).catch(caught => {
      if (!controller.signal.aborted) setResult({ url, revision, value: null, error: errorMessage(caught) });
    });
    return () => controller.abort();
  }, [url, revision]);
  useEffect(() => { if (!pollMs) return; const timer = setInterval(refresh, pollMs); return () => clearInterval(timer); }, [pollMs, refresh]);
  return { value: result.url === url ? result.value : null, error: result.url === url ? result.error : '', loading: result.url !== url || result.revision !== revision, refresh };
}
function ResourceError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="notice notice-error" role="alert"><p>{message}</p><Button variant="ghost" onClick={onRetry}><RefreshCw size={17} />重新读取</Button></div>;
}

export default function ContentWorkbench({ onClose, onMessage }: { onClose: () => void; onMessage: (message: string) => void }) {
  const [tab, setTab] = useState<'coverage' | 'jobs' | 'review'>('coverage');
  const coverage = useResource<ContentCoverageDTO>(`${base}/coverage`);
  return <Modal title="注解工作台" onClose={onClose} wide><div className="content-workbench">
    <p className="workbench-intro">从来源、候选到逐字段审核。自动补全不会计作人工审核；每次审核与回滚都会记录操作者、原因和版本。</p>
    <nav className="workbench-tabs" aria-label="注解工作台栏目">{[['coverage', '覆盖报告'], ['jobs', '补全任务'], ['review', '逐字段审核']].map(([id, title]) => <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id as typeof tab)}>{title}</button>)}</nav>
    {tab === 'coverage' && <CoveragePanel data={coverage.value} loading={coverage.loading} error={coverage.error} onRefresh={coverage.refresh} />}
    {tab === 'jobs' && <JobsPanel coverage={coverage.value} onChanged={coverage.refresh} onMessage={onMessage} />}
    {tab === 'review' && <ReviewPanel onChanged={coverage.refresh} onMessage={onMessage} />}
  </div></Modal>;
}

function CoveragePanel({ data, loading, error, onRefresh }: { data: ContentCoverageDTO | null; loading: boolean; error: string; onRefresh: () => void }) {
  const [group, setGroup] = useState<'fields' | 'books' | 'lessons' | 'partsOfSpeech'>('fields');
  return <section aria-label="注解覆盖报告"><div className="workbench-heading"><div><h3>每一种完成，都有依据。</h3><p>统计当前数据库中的字段状态，缺项与争议仍计入报告。</p></div><Button variant="ghost" busy={loading} onClick={onRefresh} aria-label="刷新覆盖报告"><RefreshCw size={18} /></Button></div>
    {error && <ResourceError message={error} onRetry={onRefresh} />}
    {!data && loading && <p className="workbench-loading" role="status">正在统计全词库字段…</p>}
    {data && <><div className="workbench-summary"><div><strong>{data.statuses.source.toLocaleString()}</strong><span>有来源的字段</span></div><div><strong>{data.statuses.generated.toLocaleString()}</strong><span>自动草稿字段</span></div><div className="summary-reviewed"><strong>{data.reviewedFields.toLocaleString()}</strong><span>有审核记录的字段</span></div></div>
      <p className="small muted">{data.totalItems.toLocaleString()} 个学习项目中，{data.annotatedItems.toLocaleString()} 个已有注解记录。适用字段 {data.applicableFields.toLocaleString()} 个，审核率 {percent(data.reviewedFields, data.applicableFields)}；不适用项不进入审核率分母。</p>
      <div className="notice notice-warning"><p>“有来源”说明内容可追溯，不能证明来源无误；自动草稿也不等于人工核查完成。</p><p>尚未整理 {data.statuses.missing || 0} · 尚缺资料 {data.statuses.unknown || 0} · 有争议 {data.statuses.disputed || 0} · 审核未通过 {data.statuses.rejected || 0}</p></div>
      <label>查看维度<select value={group} onChange={event => setGroup(event.target.value as typeof group)}><option value="fields">按注解字段</option><option value="books">按册</option><option value="lessons">按课</option><option value="partsOfSpeech">按词性</option></select></label>
      {(group === 'lessons' || group === 'partsOfSpeech') && <p className="small muted">同一项目的多课归属或多个词性候选会分别进入对应分组；不要把分组计数相加作为全库总数。</p>}
      <div className="workbench-coverage-list">{group === 'fields' ? data.fields.map(field => <div className="workbench-coverage-row" key={field.key}><div><strong>{fieldLabel(field.key)}</strong><small>已审核 {field.reviewed} / 适用 {field.applicable}</small></div><div className="workbench-coverage-bar" aria-hidden="true"><span className="coverage-source" style={{ width: `${field.total ? field.statuses.source / field.total * 100 : 0}%` }} /><span className="coverage-draft" style={{ width: `${field.total ? field.statuses.generated / field.total * 100 : 0}%` }} /><span className="coverage-reviewed" style={{ width: `${field.total ? field.reviewed / field.total * 100 : 0}%` }} /></div><p className="small muted">有来源 {field.statuses.source} · 自动草稿 {field.statuses.generated} · 已审核 {field.reviewed} · 尚缺资料 {field.statuses.unknown || 0} · 未整理 {field.statuses.missing || 0}</p></div>) : (group === 'books' ? data.books.map(row => ({ ...row, label: `第 ${row.book} 册` })) : group === 'lessons' ? data.lessons.map(row => ({ ...row, label: `第 ${row.lesson.split('-')[0]} 册 · 第 ${row.lesson.split('-')[1]} 课` })) : data.partsOfSpeech.map(row => ({ ...row, label: partLabels[row.partOfSpeech] || row.partOfSpeech }))).map(row => <div className="workbench-coverage-row" key={row.label}><div><strong>{row.label}</strong><small>{row.totalItems} 个项目</small></div><p className="small muted">已有注解 {row.annotatedItems} · 已审核字段 {row.reviewedFields} / 适用字段 {row.applicableFields} · {percent(row.reviewedFields, row.applicableFields)}</p></div>)}</div>
      <details className="workbench-history"><summary>数据版本与补全能力</summary><dl className="workbench-meta"><div><dt>本地注解资料</dt><dd>{data.artifact.available ? `${data.artifact.entries} 个项目可读取` : '尚未准备'}</dd></div><div><dt>资料格式版本</dt><dd>{data.artifact.schemaVersion || '尚无'}</dd></div><div><dt>生成器版本</dt><dd>{data.artifact.generatorVersion || '尚无'}</dd></div><div><dt>资料指纹</dt><dd>{data.artifact.datasetHash || '尚无'}</dd></div></dl>{data.providers.map(provider => <p className="small muted" key={provider.id}>{provider.id === 'local-dictionary' ? '本地词典与资料' : '云端 AI'}：{provider.available ? '可用' : '不可用'} · {provider.reason}</p>)}</details>
      <Button variant="secondary" onClick={() => downloadJson('slovo-field-coverage.json', data)}><Download size={17} />导出本次真实统计</Button>
    </>}
  </section>;
}

function JobsPanel({ coverage, onChanged, onMessage }: { coverage: ContentCoverageDTO | null; onChanged: () => void; onMessage: (message: string) => void }) {
  const resource = useResource<{ jobs: ContentJobDTO[] }>(`${base}/jobs`, 5_000);
  const [updates, setUpdates] = useState<Record<string, ContentJobDetail>>({});
  const [provider, setProvider] = useState<CreateContentJobInput['provider']>('local-dictionary');
  const [books, setBooks] = useState([1, 2, 3, 4, 5, 6]); const [fields, setFields] = useState<AnnotationKey[]>([...ANNOTATION_KEYS]);
  const [budget, setBudget] = useState('0'); const [batchSize, setBatchSize] = useState(25);
  const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(''); const [running, setRunning] = useState(''); const [pausing, setPausing] = useState(false); const [error, setError] = useState('');
  const active = useRef(true); const runner = useRef(''); const createKey = useRef<string | null>(null); const creatingRef = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; runner.current = ''; }; }, []);
  const updateJob = (job: ContentJobDetail) => { if (active.current) setUpdates(current => ({ ...current, [job.id]: job })); return job; };
  const jobs = new Map((resource.value?.jobs || []).map(job => [job.id, job]));
  for (const job of Object.values(updates)) { const remote = jobs.get(job.id); if (!remote || job.updatedAt >= remote.updatedAt) jobs.set(job.id, job); }
  const sortedJobs = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selectedProvider = coverage?.providers.find(option => option.id === provider);
  async function create(event: FormEvent) {
    event.preventDefault(); if (creatingRef.current || !books.length || !fields.length || !selectedProvider?.available) return;
    creatingRef.current = true; setCreating(true); setError(''); createKey.current ||= crypto.randomUUID();
    const input: CreateContentJobInput = { requestKey: createKey.current, provider, books, fields, costLimitCents: Math.round(Number(budget) * 100) };
    try { updateJob(await request<ContentJobDetail>(`${base}/jobs`, { method: 'POST', body: JSON.stringify(input) })); createKey.current = null; resource.refresh(); onMessage('任务已创建。处理前可以核对范围，已审核与已拒绝字段会受到保护。'); }
    catch (caught) { setError(errorMessage(caught)); } finally { creatingRef.current = false; setCreating(false); }
  }
  async function command(id: string, action: 'run-batch' | 'cancel' | 'retry') {
    if (action === 'cancel') { runner.current = ''; setPausing(true); }
    setBusy(`${id}:${action}`); setError('');
    try { updateJob(await request<ContentJobDetail>(`${base}/jobs/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(action === 'run-batch' ? { limit: batchSize } : {}) })); resource.refresh(); onChanged(); }
    catch (caught) { setError(errorMessage(caught)); } finally { if (active.current) setBusy(''); }
  }
  async function processRemaining(id: string) {
    if (runner.current || running) return; runner.current = id; setRunning(id); setPausing(false); setError('');
    let previous = jobs.get(id)?.processed ?? -1;
    try {
      while (active.current && runner.current === id) {
        const job = updateJob(await request<ContentJobDetail>(`${base}/jobs/${encodeURIComponent(id)}/run-batch`, { method: 'POST', body: JSON.stringify({ limit: batchSize }) }));
        if (!job.remaining || job.status === 'cancelled' || job.status.startsWith('completed')) break;
        if (job.busy) throw new Error('这个任务正在由另一处处理，请稍后刷新。');
        if (job.processed <= previous) throw new Error('这一批没有产生新进度，请检查任务详情后再继续。');
        previous = job.processed;
      }
      if (active.current) { resource.refresh(); onChanged(); }
    } catch (caught) { if (active.current) setError(errorMessage(caught)); }
    finally { if (runner.current === id) runner.current = ''; if (active.current) { setRunning(''); setPausing(false); } }
  }
  async function details(id: string) { try { updateJob(await request<ContentJobDetail>(`${base}/jobs/${encodeURIComponent(id)}`)); } catch (caught) { setError(errorMessage(caught)); } }
  function changeSelection(action: () => void) { createKey.current = null; action(); }
  return <section aria-label="注解补全任务"><div className="workbench-heading"><div><h3>分批整理，进度随时保留。</h3><p>关闭工作台会停止发起下一批，已经保存的结果不会丢失。</p></div><Button variant="ghost" aria-label="刷新补全任务" onClick={resource.refresh}><RefreshCw size={18} /></Button></div>
    <details className="workbench-card"><summary>新建补全任务</summary><form onSubmit={event => void create(event)}>
      <label>补全方式<select value={provider} onChange={event => changeSelection(() => setProvider(event.target.value as typeof provider))}>{(coverage?.providers || []).map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.id === 'local-dictionary' ? '本地词典与已准备资料' : '云端 AI'}{option.available ? '' : '（不可用）'}</option>)}</select></label>
      <p className="small muted">{selectedProvider?.reason || '正在读取补全能力…'}</p>
      <fieldset className="workbench-book-choices"><legend>教材范围</legend>{[1, 2, 3, 4, 5, 6].map(book => <label className="checkbox-label" key={book}><input type="checkbox" checked={books.includes(book)} onChange={() => changeSelection(() => setBooks(current => current.includes(book) ? current.filter(value => value !== book) : [...current, book]))} />第 {book} 册</label>)}</fieldset>
      <details className="workbench-field-choices"><summary>需要整理的字段 · 已选 {fields.length} / {ANNOTATION_KEYS.length}</summary><div className="toolbar"><Button variant="ghost" onClick={() => changeSelection(() => setFields([...ANNOTATION_KEYS]))}>选择全部字段</Button><Button variant="ghost" onClick={() => changeSelection(() => setFields([]))}>清空字段</Button></div><div>{ANNOTATION_KEYS.map(key => <label className="checkbox-label" key={key}><input type="checkbox" checked={fields.includes(key)} onChange={() => changeSelection(() => setFields(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]))} />{fieldLabel(key)}</label>)}</div></details>
      <label>费用上限（美元）<input type="number" min="0" max="1000" step="0.01" value={budget} onChange={event => changeSelection(() => setBudget(event.target.value))} required /></label><p className="small muted">本地资料整理不产生云端费用。可用方式与实际花费以任务记录为准；达到上限时由服务器停止继续计费。</p>
      <Button type="submit" busy={creating} disabled={!selectedProvider?.available || !books.length || !fields.length || !Number.isFinite(Number(budget))}><Play size={17} />创建任务</Button>
    </form></details>
    <label>每批项目数<select value={batchSize} onChange={event => setBatchSize(Number(event.target.value))}>{[10, 25, 50].map(value => <option key={value} value={value}>{value} 个项目</option>)}</select></label>
    {resource.error && <ResourceError message={resource.error} onRetry={resource.refresh} />}{error && <p className="notice notice-error" role="alert">{error}</p>}
    {!resource.value && resource.loading && <p className="workbench-loading" role="status">正在读取任务…</p>}
    {!resource.loading && !sortedJobs.length && !resource.error && <EmptyState title="还没有补全任务">先选定教材与字段，创建一项可追踪的任务。</EmptyState>}
    {sortedJobs.map(job => {
      const detailed = updates[job.id]; const canRun = job.remaining > 0 && !['cancelled', 'completed', 'completed-with-errors'].includes(job.status);
      return <article className="workbench-card" key={job.id} data-job-id={job.id}><div className="workbench-card-header"><div><h4>第 {job.selection.books.join('、')} 册 · {job.selection.fields.length} 个字段</h4><small>{dateLabel(job.createdAt)} · {job.actor.name}</small></div><Status value={job.status} /></div>
        <div className="workbench-progress-caption"><span>已处理 {job.processed} / {job.total}</span><span>完成 {job.completed}</span><span>失败 {job.failed}</span><span>保护或跳过 {job.skipped}</span><span>剩余 {job.remaining}</span></div><div className="progress-track" role="progressbar" aria-label="任务处理进度" aria-valuemin={0} aria-valuemax={job.total || 1} aria-valuenow={job.processed}><span style={{ width: `${job.total ? Math.min(100, job.processed / job.total * 100) : 0}%` }} /></div>
        <p className="small muted">{job.provider === 'local-dictionary' ? '本地词典与资料' : '云端 AI'} · 已花费 ${(job.costSpentCents / 100).toFixed(2)} / 上限 ${(job.costLimitCents / 100).toFixed(2)}</p>
        <div className="toolbar">{canRun && <><Button variant="secondary" disabled={!!running || !!busy || job.busy} onClick={() => void command(job.id, 'run-batch')}>处理下一批</Button>{running === job.id ? <Button variant="secondary" disabled={pausing} onClick={() => { runner.current = ''; setPausing(true); onMessage('当前批次完成后暂停。可以稍后继续处理剩余项目。'); }}><Pause size={16} />{pausing ? '正在完成当前批次' : '暂停连续处理'}</Button> : <Button disabled={!!running || !!busy || job.busy} onClick={() => void processRemaining(job.id)}><Play size={16} />连续处理剩余项目</Button>}<Button variant="ghost" busy={busy === `${job.id}:cancel`} onClick={() => void command(job.id, 'cancel')}><X size={16} />取消任务</Button></>}{(job.failed > 0 || (job.status === 'cancelled' && job.remaining > 0)) && <Button variant="secondary" disabled={!!running || !!busy} onClick={() => void command(job.id, 'retry')}><RotateCcw size={16} />{job.status === 'cancelled' ? '恢复未完成任务' : '只重试失败项'}</Button>}<Button variant="ghost" onClick={() => void details(job.id)}>读取任务详情</Button></div>
        {detailed && <details className="workbench-job-details" open={detailed.failures.length > 0}><summary>任务版本与失败记录</summary><dl className="workbench-meta"><div><dt>任务编号</dt><dd>{job.id}</dd></div><div><dt>字段范围</dt><dd>{job.selection.fields.map(fieldLabel).join('、')}</dd></div><div><dt>资料 / 生成器版本</dt><dd>{job.schemaVersion} / {job.generatorVersion}</dd></div><div><dt>数据集指纹</dt><dd>{job.datasetHash}</dd></div><div><dt>最后更新</dt><dd>{dateLabel(job.updatedAt)}</dd></div></dl>{detailed.failures.length ? detailed.failures.map(failure => <div className="notice notice-warning" key={failure.id}><p>{failure.sourceKey} · 已尝试 {failure.attempts} 次</p><p>{failure.error}</p></div>) : <p className="small muted">当前没有失败项。</p>}</details>}
      </article>;
    })}
  </section>;
}

interface Filters { book: string; lesson: string; partOfSpeech: string; field: string; status: string; q: string }
const initialFilters: Filters = { book: '', lesson: '', partOfSpeech: '', field: '', status: '', q: '' };
function ReviewPanel({ onChanged, onMessage }: { onChanged: () => void; onMessage: (message: string) => void }) {
  const [draft, setDraft] = useState(initialFilters); const [filters, setFilters] = useState(initialFilters); const [offset, setOffset] = useState(0); const [selected, setSelected] = useState<string | null>(null);
  const parameters = new URLSearchParams({ offset: String(offset), limit: '20' }); Object.entries(filters).forEach(([key, value]) => { if (value) parameters.set(key, value); });
  const resource = useResource<ContentListResponse>(`${base}/items?${parameters}`);
  function changed() { resource.refresh(); onChanged(); }
  if (selected) return <ItemReviewer itemId={selected} initialField={filters.field as AnnotationKey || 'meaning'} onBack={() => setSelected(null)} onChanged={changed} onMessage={onMessage} />;
  const lessons = draft.book ? Array.from({ length: [17, 12, 12, 12, 8, 8][Number(draft.book) - 1] }, (_, index) => `${draft.book}-${index + 1}`) : [];
  return <section aria-label="注解字段审核"><div className="workbench-heading"><div><h3>一次核对一个字段。</h3><p>先定位义项与来源，再决定是否确认。教材原始行保持独立保存。</p></div><Button variant="ghost" onClick={resource.refresh} aria-label="刷新审核列表"><RefreshCw size={18} /></Button></div>
    <form className="workbench-filters" onSubmit={event => { event.preventDefault(); setFilters({ ...draft, q: draft.q.trim() }); setOffset(0); }}>
      <label>册数<select value={draft.book} onChange={event => setDraft(current => ({ ...current, book: event.target.value, lesson: '' }))}><option value="">全部册</option>{[1, 2, 3, 4, 5, 6].map(book => <option key={book} value={book}>第 {book} 册</option>)}</select></label>
      <label>课次<select value={draft.lesson} disabled={!draft.book} onChange={event => setDraft(current => ({ ...current, lesson: event.target.value }))}><option value="">{draft.book ? '全部课次' : '先选择册数'}</option>{lessons.map(lesson => <option key={lesson} value={lesson}>第 {lesson.split('-')[1]} 课</option>)}</select></label>
      <label>词性<select value={draft.partOfSpeech} onChange={event => setDraft(current => ({ ...current, partOfSpeech: event.target.value }))}><option value="">全部词性</option>{CONTENT_PARTS_OF_SPEECH.map(part => <option key={part} value={part}>{partLabels[part] || part}</option>)}</select></label>
      <label>注解字段<select value={draft.field} onChange={event => setDraft(current => ({ ...current, field: event.target.value }))}><option value="">全部字段</option>{ANNOTATION_KEYS.map(key => <option key={key} value={key}>{fieldLabel(key)}</option>)}</select></label>
      <label>字段状态<select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}><option value="">全部状态</option>{['source', 'generated', 'reviewed', 'unknown', 'disputed', 'not-applicable', 'rejected', 'missing'].map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
      <label className="filter-wide">搜索俄语或中文<input value={draft.q} onChange={event => setDraft(current => ({ ...current, q: event.target.value }))} placeholder="保留不同词性与义项" /></label><Button type="submit" className="filter-wide"><Search size={17} />应用筛选</Button>
    </form>
    {resource.error && <ResourceError message={resource.error} onRetry={resource.refresh} />}{resource.loading && <p className="workbench-loading" role="status">正在读取审核范围…</p>}
    {!resource.loading && resource.value && <><p className="small muted">共 {resource.value.total} 个学习项目。选择项目后可切换其中的每一个注解字段。</p>{resource.value.items.length ? <div className="workbench-field-list">{resource.value.items.map(item => {
      const status = filters.field ? item.fields[filters.field as AnnotationKey] || 'missing' : '';
      const pending = Object.values(item.fields).filter(value => ['generated', 'unknown', 'disputed', 'rejected', 'missing'].includes(value || '')).length;
      return <button className="workbench-field-row" key={item.id} data-item-id={item.id} onClick={() => setSelected(item.id)}><div><strong lang="ru">{item.russian}</strong><p>{item.chinese}</p><small>第 {item.book} 册 · 第 {item.lessons.join('、')} 课 · 内容版本 {item.contentVersion}</small></div><span>{status ? <Status value={status} /> : <small>{pending} 个待处理字段</small>}<ArrowRight size={18} /></span></button>;
    })}</div> : <EmptyState title="当前条件下没有项目">调整册次、词性或字段状态后再查询。</EmptyState>}<div className="workbench-pagination"><Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(current => Math.max(0, current - 20))}>上一页</Button><span>{resource.value.total ? offset + 1 : 0}–{Math.min(offset + 20, resource.value.total)} / {resource.value.total}</span><Button variant="secondary" disabled={offset + 20 >= resource.value.total} onClick={() => setOffset(current => current + 20)}>下一页</Button></div></>}
  </section>;
}

function ItemReviewer({ itemId, initialField, onBack, onChanged, onMessage }: { itemId: string; initialField: AnnotationKey; onBack: () => void; onChanged: () => void; onMessage: (message: string) => void }) {
  const [fieldKey, setFieldKey] = useState(initialField);
  const resource = useResource<ContentItemDetail>(`${base}/items/${encodeURIComponent(itemId)}?field=${fieldKey}`);
  const detail = resource.value; const field = detail?.fields.find(candidate => candidate.key === fieldKey);
  const changed = () => { resource.refresh(); onChanged(); };
  return <section aria-label="单字段审核"><Button variant="ghost" onClick={onBack}><ArrowLeft size={17} />返回审核列表</Button>
    {resource.error && <ResourceError message={resource.error} onRetry={resource.refresh} />}{!detail && resource.loading && <p className="workbench-loading" role="status">正在读取字段与版本…</p>}
    {detail && <><div className="detail-word"><p className="eyebrow">第 {detail.item.book} 册 · 第 {detail.item.lessons.join('、')} 课</p><h2 lang="ru" className="russian">{detail.item.russian}</h2><p>{detail.item.chinese}</p></div><label>当前审核字段<select value={fieldKey} onChange={event => setFieldKey(event.target.value as AnnotationKey)}>{ANNOTATION_KEYS.map(key => <option key={key} value={key}>{fieldLabel(key)} · {statusLabels[detail.item.fields[key] || 'missing']}</option>)}</select></label>
      <div className="section-heading"><h3>{fieldLabel(fieldKey)}</h3><Status value={field?.evidence?.status || 'missing'} /></div>
      {field?.protected && <p className="notice">这个字段已被审核或拒绝，自动补全不会覆盖。再次审核仍会生成新的版本记录。</p>}
      <EvidenceCard evidence={field?.evidence || null} title="当前内容与依据" />
      <details className="workbench-evidence"><summary>核对教材原始行</summary><p className="small muted">原表第 {detail.source.rowNumber} 行 · 来源版本 {detail.source.sourceVersion}。原始资料不会被下方操作改写。</p><div className="annotation-content"><AnnotationValue value={detail.source.raw} /></div></details>
      <FieldEditor key={`${itemId}:${fieldKey}:${detail.item.contentVersion}`} detail={detail} fieldKey={fieldKey} evidence={field?.evidence || null} onSaved={changed} onMessage={onMessage} />
      <RevisionHistory revisions={detail.revisions.filter(revision => revision.fieldKey === fieldKey)} baseVersion={detail.item.contentVersion} onSaved={changed} onMessage={onMessage} />
    </>}
  </section>;
}

function EvidenceCard({ evidence, title }: { evidence: EvidenceField | null; title: string }) {
  return <section className="workbench-evidence"><h4>{title}</h4><div className="annotation-content"><AnnotationValue value={evidence?.status === 'not-applicable' ? '此字段不适用于当前内容。' : evidence?.value} /></div>
    <dl className="workbench-meta"><div><dt>来源</dt><dd>{evidence?.source ? annotationSourceLabel(evidence.source) : '尚无可追溯来源'}</dd></div><div><dt>整理方式</dt><dd>{evidence?.method ? annotationMethodLabels[evidence.method] || evidence.method : '尚未记录'}</dd></div><div><dt>字段资料版本</dt><dd>{evidence?.version || '尚无'}</dd></div><div><dt>最后更新</dt><dd>{evidence?.updatedAt ? dateLabel(evidence.updatedAt) : '尚无'}</dd></div></dl>
  </section>;
}

function FieldEditor({ detail, fieldKey, evidence, onSaved, onMessage }: { detail: ContentItemDetail; fieldKey: AnnotationKey; evidence: EvidenceField | null; onSaved: () => void; onMessage: (message: string) => void }) {
  const initialJson = evidence?.value != null && typeof evidence.value !== 'string';
  const [format, setFormat] = useState(initialJson ? 'json' : 'text');
  const [value, setValue] = useState(initialJson ? JSON.stringify(evidence?.value, null, 2) : evidence?.value == null ? '' : String(evidence.value));
  const [source, setSource] = useState(evidence?.source || ''); const [method, setMethod] = useState(evidence?.method || '');
  const [reason, setReason] = useState(''); const [acknowledge, setAcknowledge] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [conflict, setConflict] = useState(false);
  const requestKey = useRef<string | null>(null); const lastAction = useRef<'approve' | 'reject' | null>(null); const submitting = useRef(false);
  let parsedValue: unknown = value.trim() ? value : null; let parseError = '';
  if (format === 'json' && value.trim()) { try { parsedValue = JSON.parse(value); } catch { parseError = '结构化内容不是有效 JSON，请检查引号、逗号与括号。'; } }
  function edit(action: () => void) { action(); requestKey.current = null; setAcknowledge(false); }
  async function save(action: 'approve' | 'reject') {
    if (submitting.current || reason.trim().length < 3 || (action === 'approve' && (!acknowledge || parsedValue === null || parseError))) return;
    submitting.current = true; setBusy(true); setError('');
    if (lastAction.current !== action) { requestKey.current = null; lastAction.current = action; }
    requestKey.current ||= crypto.randomUUID();
    const input: ReviewAnnotationInput = { requestKey: requestKey.current, baseVersion: detail.item.contentVersion, action, reason: reason.trim(), ...(action === 'approve' ? { value: parsedValue, source: source.trim(), method: method.trim(), acknowledge } : {}) };
    try {
      await request<AnnotationMutationResult>(`${base}/items/${encodeURIComponent(detail.item.id)}/fields/${fieldKey}/review`, { method: 'POST', body: JSON.stringify(input) });
      requestKey.current = null; onMessage(action === 'approve' ? '此字段已确认，审核依据与版本已保存。' : '此字段已拒绝，原值与拒绝原因仍保留。'); onSaved();
    } catch (caught) { setError(errorMessage(caught)); if (caught instanceof ApiError && caught.status === 409) setConflict(true); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="workbench-review-form"><h4>审核当前字段 · 内容版本 {detail.item.contentVersion}</h4>
    <label>编辑方式<select value={format} onChange={event => edit(() => setFormat(event.target.value))}><option value="text">文字内容</option><option value="json">结构化 JSON（词形表、列表等）</option></select></label>
    <label>字段内容<textarea className={format === 'json' ? 'workbench-json' : ''} rows={format === 'json' ? 12 : 5} value={value} onChange={event => edit(() => setValue(event.target.value))} spellCheck={false} /></label>
    {parseError && <p className="notice notice-error" role="alert">{parseError}</p>}
    <label>来源与依据<textarea rows={2} maxLength={8000} value={source} onChange={event => edit(() => setSource(event.target.value))} placeholder="填写可核查的出处、页码或链接" /></label>
    <label>整理方式<input value={method} maxLength={2000} onChange={event => edit(() => setMethod(event.target.value))} placeholder="例如：对照教材原页人工核对" /></label>
    <label>审核原因<textarea rows={3} minLength={3} maxLength={1000} value={reason} onChange={event => { requestKey.current = null; setReason(event.target.value); }} placeholder="说明采用或拒绝的依据；至少 3 个字" /></label>
    <label className="checkbox-label confirmation"><input type="checkbox" checked={acknowledge} onChange={event => { requestKey.current = null; setAcknowledge(event.target.checked); }} />我已核对来源与适用义项，确认这一个字段。</label>
    <p className="small muted">确认会保存上方编辑内容。拒绝只记录当前候选不被采用，保留原值；编辑内容不会随拒绝发布。</p>
    {!evidence && <p className="notice notice-warning">这个字段尚无候选记录，请先运行补全任务，再核对和审核。</p>}
    <div className="toolbar"><Button disabled={!evidence || conflict || !acknowledge || !!parseError || parsedValue === null || !source.trim() || reason.trim().length < 3} busy={busy} onClick={() => void save('approve')}><ShieldCheck size={17} />确认此字段</Button><Button variant="secondary" disabled={!evidence || conflict || reason.trim().length < 3} busy={busy} onClick={() => void save('reject')}><X size={17} />拒绝当前候选</Button></div>
    {error && <p className="notice notice-error" role="alert">{error}</p>}{conflict && <div className="notice notice-warning"><p>内容已被其他操作更新。当前编辑不会自动覆盖新版本，请先复制需要保留的文字，再重新读取。</p><Button variant="secondary" onClick={onSaved}>读取最新版本</Button></div>}
  </section>;
}

function RevisionHistory({ revisions, baseVersion, onSaved, onMessage }: { revisions: AnnotationRevisionDTO[]; baseVersion: number; onSaved: () => void; onMessage: (message: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const requestKey = useRef<string | null>(null);
  async function rollback(revision: AnnotationRevisionDTO) {
    if (busy || reason.trim().length < 3) return; setBusy(true); setError(''); requestKey.current ||= crypto.randomUUID();
    const input: RollbackAnnotationInput = { requestKey: requestKey.current, baseVersion, reason: reason.trim() };
    try { await request<AnnotationMutationResult>(`${base}/revisions/${encodeURIComponent(revision.id)}/rollback`, { method: 'POST', body: JSON.stringify(input) }); requestKey.current = null; setSelected(null); setReason(''); onMessage('回滚已保存为新版本，既有审核历史仍保留。'); onSaved(); }
    catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  }
  return <details className="workbench-history"><summary><History size={16} /> 此字段的版本历史 · {revisions.length} 条</summary><p className="small muted">这里展示当前字段最近的版本记录。恢复会采用所选版本的“变更之后”内容，写入新版本，不删除历史。</p>
    {!revisions.length && <p className="small muted">尚无此字段的变更记录。</p>}
    {revisions.map(revision => <article className="workbench-history-card" key={revision.id} data-revision-id={revision.id}><div className="section-heading"><h4>版本 {revision.version} · {{ generate: '生成候选', approve: '确认字段', reject: '拒绝候选', rollback: '回滚' }[revision.action]}</h4><Status value={revision.after?.status || 'missing'} /></div><p>{revision.reason}</p><p className="small muted">{revision.actor.name} · {dateLabel(revision.createdAt)}</p><details><summary>查看这次变更前后</summary><EvidenceCard evidence={revision.before} title="变更之前" /><EvidenceCard evidence={revision.after} title="变更之后" /></details>
      {selected === revision.id ? <div className="workbench-review-form"><EvidenceCard evidence={revision.after} title={`将恢复到版本 ${revision.version} 的内容`} /><label>回滚原因<textarea rows={2} value={reason} onChange={event => { requestKey.current = null; setReason(event.target.value); }} placeholder="说明为什么需要恢复；至少 3 个字" /></label><div className="toolbar"><Button variant="secondary" busy={busy} disabled={reason.trim().length < 3} onClick={() => void rollback(revision)}><RotateCcw size={16} />确认恢复此版本</Button><Button variant="ghost" disabled={busy} onClick={() => setSelected(null)}>取消</Button></div></div> : <Button variant="ghost" onClick={() => { setSelected(revision.id); setReason(''); requestKey.current = null; }}>恢复到此版本</Button>}
    </article>)}{error && <p className="notice notice-error" role="alert">{error}</p>}
  </details>;
}
