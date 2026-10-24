'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Bookmark, Check, ChevronRight, CircleUserRound, Download, Flame, Layers3, Leaf, RefreshCw, Search, Settings2, Sun, WifiOff, X } from 'lucide-react';
import { MotionConfig, motion, useReducedMotion } from 'motion/react';
import type { BootstrapDTO, Direction, ItemsResponse, LearningItemDTO } from '../domain/types';
import { dailyStatsFor, isDue, localDateKey, nextQuestion, type StudySession } from '../domain/learning';
import { matchesSearch } from '../domain/search';
import { offlineStore } from '../lib/offline';
import { api, ApiError, authClient, errorMessage, fetchAllItems, setExpectedUser } from '../lib/api-client';
import { Button, Modal, PageTitle, TextLink } from './ui';
import AuthPanel from './auth-panel';
import StudyPanel from './study-panel';
import WordList from './word-list';
import ItemDetail from './item-detail';
import DecksPanel from './decks-panel';
import ProfilePanel from './profile-panel';

type View = 'today' | 'textbooks' | 'decks' | 'profile';
interface StudyData { data: ItemsResponse; session?: StudySession; direction: Direction | 'mixed'; limit: number; random: boolean }
interface SavedScope { name: string; lessonIds: string[] }
const navigation = [{ id: 'today' as const, label: '今日', icon: Sun }, { id: 'textbooks' as const, label: '教材', icon: BookOpen }, { id: 'decks' as const, label: '我的词库', icon: Layers3 }, { id: 'profile' as const, label: '我的', icon: CircleUserRound }];
const scopeKey = (lessonIds: string[]) => `lessons:${[...lessonIds].sort().join(',')}`;

async function ensureOfflineShellReady(): Promise<void> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) throw new Error('当前地址无法准备离线页面。请使用 HTTPS 或本机地址打开后重试。');
  await new Promise<void>((resolve, reject) => {
    const channels: MessageChannel[] = []; let finished = false;
    const finish = (error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', check);
      for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
      if (error) reject(error); else resolve();
    };
    const check = () => {
      const worker = navigator.serviceWorker.controller; if (!worker || finished) return;
      const channel = new MessageChannel(); channels.push(channel);
      channel.port1.onmessage = event => {
        if (event.data?.type === 'SLOVO_SHELL_READY' && event.data.version === 2 && event.data.ready) finish();
      };
      try { worker.postMessage({ type: 'SLOVO_SHELL_STATUS' }, [channel.port2]); }
      catch { finish(new Error('离线页面正在更新，请保持联网后重试。')); }
    };
    const timer = setTimeout(() => finish(new Error('词条已保留，但离线页面仍在准备。请保持联网，稍后重试“下载离线”。')), 20_000);
    navigator.serviceWorker.addEventListener('controllerchange', check);
    void navigator.serviceWorker.ready.then(check).catch(() => finish(new Error('暂时无法准备离线页面，请保持联网后重试。')));
    check();
  });
}

export default function SlovoApp() {
  const reducedMotion = useReducedMotion();
  const [now, setNow] = useState(() => new Date());
  const [bootstrap, setBootstrap] = useState<BootstrapDTO | null>(null); const [loading, setLoading] = useState(true); const [demoMode, setDemoMode] = useState(false); const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [view, setView] = useState<View>('today'); const [selected, setSelected] = useState<string[]>([]); const [goal, setGoal] = useState(10); const [activeBook, setActiveBook] = useState(1); const [direction, setDirection] = useState<Direction | 'mixed'>('mixed'); const [roundSize, setRoundSize] = useState(20); const [random, setRandom] = useState(false); const [reviewScope, setReviewScope] = useState<'selection' | 'all'>('selection');
  const [study, setStudy] = useState<StudyData | null>(null); const [resume, setResume] = useState<StudySession | null>(null); const [detail, setDetail] = useState<LearningItemDTO | null>(null); const [scopes, setScopes] = useState<SavedScope[]>([]);
  const [list, setList] = useState<ItemsResponse>({ items: [], states: {}, total: 0 }); const [listLoading, setListLoading] = useState(false); const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [options, setOptions] = useState(false); const [busy, setBusy] = useState(false); const [downloadProgress, setDownloadProgress] = useState('');
  const [counts, setCounts] = useState({ pending: 0, conflicts: 0 }); const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [syncing, setSyncing] = useState(false);
  const activeUser = useRef<string | null>(null); const syncLock = useRef(false); const syncRequested = useRef(false); const mainRef = useRef<HTMLElement>(null); const listRequest = useRef(0);
  const selectedString = [...selected].sort().join(',');
  const isStudying = Boolean(study);

  useEffect(() => {
    const updateClock = () => { if (document.visibilityState === 'visible') setNow(new Date()); };
    const timer = setInterval(updateClock, 60_000);
    document.addEventListener('visibilitychange', updateClock);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', updateClock); };
  }, []);

  const refreshCounts = useCallback(async (userId: string) => { setCounts(await offlineStore.getCounts(userId)); }, []);
  const acceptBootstrap = useCallback(async (data: BootstrapDTO) => {
    await offlineStore.saveBootstrap(data); setExpectedUser(data.user.id); setBootstrap(data); setDemoMode(data.demoMode); localStorage.setItem('slovo:active-account', data.user.id);
    if (activeUser.current !== data.user.id) {
      activeUser.current = data.user.id; setSelected(data.selection.lessonIds); setGoal(data.selection.dailyGoal); setStudy(null); setDetail(null); setView('today'); setActiveBook(1); setQuery(''); setFilter('all'); setList({ items: [], states: {}, total: 0 }); setDirection('mixed'); setRoundSize(20); setRandom(false); setReviewScope('selection'); setOptions(false);
      setScopes(await offlineStore.getDraft<SavedScope[]>(data.user.id, 'saved-scopes') || []);
    }
    const saved = await offlineStore.loadSession(data.user.id); setResume(saved && nextQuestion(saved) ? saved : null); await refreshCounts(data.user.id);
  }, [refreshCounts]);
  const refresh = useCallback(async () => { await acceptBootstrap(await api.bootstrap()); setOnline(true); }, [acceptBootstrap]);
  useEffect(() => {
    let mounted = true;
    const theme = localStorage.getItem('slovo:theme'); if (theme) document.documentElement.dataset.theme = theme;
    void api.config().then(config => { if (mounted) setDemoMode(config.demoMode); }).catch(() => {});
    void (async () => {
      try {
        if (localStorage.getItem('slovo:pending-signout')) {
          if (!navigator.onLine) return;
          const result = await authClient.signOut(); if (result.error) throw new Error('请联网完成退出后再登录。'); localStorage.removeItem('slovo:pending-signout');
        }
        await refresh();
      } catch (caught) {
        if (caught instanceof ApiError) {
          if (caught.status === 401) { await offlineStore.deactivateAccount().catch(() => {}); setExpectedUser(null); }
          else if (mounted) setError(errorMessage(caught));
        } else {
          const cached = await offlineStore.getOfflineBootstrap().catch(() => null);
          if (cached && mounted) { setBootstrap(cached); activeUser.current = cached.user.id; setExpectedUser(cached.user.id); setSelected(cached.selection.lessonIds); setGoal(cached.selection.dailyGoal); setOnline(false); setResume(await offlineStore.loadSession(cached.user.id)); setScopes(await offlineStore.getDraft<SavedScope[]>(cached.user.id, 'saved-scopes') || []); await refreshCounts(cached.user.id); }
          else if (mounted && !navigator.onLine) setError('首次登录需要联网。已有账号请在联网登录后下载课次。');
          else if (mounted) setError(errorMessage(caught));
        }
      } finally { if (mounted) setLoading(false); }
    })();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { mounted = false; };
  }, [refresh, refreshCounts]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 6500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => { mainRef.current?.focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }, [view, isStudying]);

  const sync = useCallback(async function synchronize(): Promise<void> {
    const userId = activeUser.current; if (!userId) return;
    if (syncLock.current) { syncRequested.current = true; return; }
    if (!navigator.onLine) { await refreshCounts(userId); return; }
    syncLock.current = true; setSyncing(true);
    try {
      // Read again after each batch: a fast answer can arrive while a previous
      // request is in flight. Coalesced calls must not strand that final event.
      for (;;) {
        syncRequested.current = false;
        const events = (await offlineStore.getPendingEvents(userId)).slice(0, 50);
        if (activeUser.current !== userId) return;
        if (!events.length) { if (syncRequested.current) continue; break; }
        const result = await api.reviews(events); await offlineStore.applySyncResult(userId, result);
        if (!result.acceptedIds.length && !result.conflicts.length) throw new Error('服务器尚未确认这批记录，请稍后重试。');
      }
      await refreshCounts(userId);
      const fresh = await api.bootstrap();
      if (fresh.user.id === userId) { await offlineStore.saveBootstrap(fresh); setBootstrap(fresh); setOnline(true); }
      else throw new Error('账号已在其他窗口切换，请重新登录');
    } catch (caught) { syncRequested.current = false; setError(`${errorMessage(caught)} 答题记录仍保留在本机。`); }
    finally {
      syncLock.current = false; setSyncing(false);
      if (syncRequested.current && activeUser.current === userId) { syncRequested.current = false; void synchronize(); }
    }
  }, [refreshCounts]);
  useEffect(() => {
    const connected = () => { setOnline(true); void sync(); }; const disconnected = () => setOnline(false); const visible = () => { if (document.visibilityState === 'visible') void sync(); };
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); document.removeEventListener('visibilitychange', visible); };
  }, [sync]);
  useEffect(() => {
    function accountChanged(event: StorageEvent) {
      if (event.key !== 'slovo:active-account' || !activeUser.current || event.newValue === activeUser.current) return;
      activeUser.current = null; setExpectedUser(null); setBootstrap(null); setStudy(null); setDetail(null); setList({ items: [], states: {}, total: 0 }); setResume(null); setScopes([]); setView('today'); setQuery(''); setFilter('all'); setOptions(false); setMessage('账号已在其他窗口切换，本窗口已锁定。请重新登录。');
    }
    window.addEventListener('storage', accountChanged); return () => window.removeEventListener('storage', accountChanged);
  }, []);
  useEffect(() => { if (bootstrap?.user.id) void sync(); }, [bootstrap?.user.id, sync]);

  async function logout() {
    await sync();
    localStorage.setItem('slovo:pending-signout', '1');
    await offlineStore.deactivateAccount(); activeUser.current = null; setExpectedUser(null); localStorage.removeItem('slovo:active-account'); setBootstrap(null); setStudy(null); setDetail(null); setList({ items: [], states: {}, total: 0 }); setResume(null); setScopes([]); setView('today'); setQuery(''); setFilter('all'); setOptions(false);
    try { const result = await authClient.signOut(); if (result.error) throw new Error(result.error.message); localStorage.removeItem('slovo:pending-signout'); } catch { setMessage('本机已锁定。未同步记录按原账号保留，联网后完成服务器退出。'); }
  }
  async function savePreferences(lessonIds = selected, dailyGoal = goal) {
    await api.preferences({ lessonIds, dailyGoal });
    if (bootstrap) { const updated = { ...bootstrap, selection: { lessonIds, dailyGoal } }; setBootstrap(updated); await offlineStore.saveBootstrap(updated); }
  }
  async function loadList(more = false) {
    if (!bootstrap) return; const requestNumber = ++listRequest.current; setListLoading(true); setError('');
    try {
      const book = bootstrap.books.find(candidate => candidate.id === activeBook);
      const lessons = selectedString || book?.lessons.map(lesson => lesson.id).join(',') || '';
      if (!online) {
        const cached = await offlineStore.getCachedSelection(bootstrap.user.id, scopeKey(selected));
        if (!cached) throw new Error('这个范围尚未下载。请联网后选择课次并下载。');
        const items = cached.items.filter(item => {
          if (query && !matchesSearch(query, item.russian, item.chinese, item.morphology, item.searchKey)) return false;
          const states = Object.entries(cached.states).filter(([id]) => id.startsWith(`${item.id}:`)).map(([, state]) => state);
          if (filter === 'new') return !states.length;
          if (filter === 'learning') return states.length > 0;
          if (filter === 'due') return states.some(state => isDue(state.card, new Date()));
          if (filter === 'favorites') return item.favorite;
          if (filter === 'suspended') return item.suspended;
          if (filter === 'mistakes') return states.some(state => state.flag === 'mistake');
          return true;
        });
        if (filter === 'mistakes') setMessage('离线错词筛选仅包含缓存中已记录的错词；联网后会更新。');
        if (requestNumber === listRequest.current) setList({ ...cached, items, total: items.length }); return;
      }
      const result = await api.items({ lessons, q: query, filter, offset: more ? list.items.length : 0, limit: 100 });
      if (requestNumber === listRequest.current) setList(current => more ? { ...result, items: [...current.items, ...result.items], states: { ...current.states, ...result.states } } : result);
    } catch (caught) { if (requestNumber === listRequest.current) { setError(errorMessage(caught)); if (!more) setList({ items: [], states: {}, total: 0 }); } } finally { if (requestNumber === listRequest.current) setListLoading(false); }
  }
  useEffect(() => {
    if (view !== 'textbooks' || !bootstrap) return;
    const timer = setTimeout(() => { void loadList(); }, query ? 280 : 0); return () => clearTimeout(timer);
    // loadList captures the current query and selected scope; a new effect cancels debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selectedString, activeBook, query, filter, bootstrap?.user.id, online]);
  async function selectionData(deckId?: string, studyFilter = 'all'): Promise<ItemsResponse> {
    const userId = bootstrap!.user.id; const key = deckId ? `deck:${deckId}` : scopeKey(selected);
    if (!online) {
      const cached = await offlineStore.getCachedSelection(userId, key);
      if (!cached) throw new Error('请先联网下载这个学习范围。');
      if (reviewScope === 'all' && (studyFilter === 'due' || studyFilter === 'mistakes')) setMessage('离线时仅复习当前下载范围；联网后可复习全部词库。');
      return cached;
    }
    const result = await fetchAllItems({ ...(deckId ? { deckId } : { lessons: (studyFilter === 'due' || studyFilter === 'mistakes') && reviewScope === 'all' ? undefined : selectedString }), filter: studyFilter }, (done, total) => setDownloadProgress(`${done} / ${total} 条`));
    await offlineStore.primeStates(userId, result.states);
    Object.assign(result.states, await offlineStore.getStates(userId, result.items.map(item => item.id)));
    return result;
  }
  async function startStudy(studyFilter = 'all', deckId?: string) {
    if (!bootstrap || busy) return;
    if (syncLock.current) { setMessage('正在同步刚才的学习记录，完成后即可开始下一轮。'); return; }
    if (!deckId && !selected.length && reviewScope !== 'all') { setView('textbooks'); setMessage('先选择想学的课次。'); return; }
    setBusy(true); setError('');
    try {
      if (online && !deckId) await savePreferences();
      let data = await selectionData(deckId, studyFilter);
      const known = new Set(Object.keys(data.states).map(id => id.slice(0, id.lastIndexOf(':'))));
      const pendingNew = await offlineStore.countPendingNewItems(bootstrap.user.id, localDateKey(new Date(), bootstrap.user.timeZone), bootstrap.user.timeZone);
      const todayStats = dailyStatsFor(bootstrap.stats, bootstrap.user.timeZone, new Date());
      const allowance = Math.max(0, goal - (todayStats.newToday ?? 0) - pendingNew); let newCount = 0;
      const eligible = data.items.filter(item => {
        if (item.missingMeaning || item.meaningDisputed || item.suspended) return false;
        if (studyFilter === 'due' && !Object.entries(data.states).some(([id, state]) => id.startsWith(`${item.id}:`) && isDue(state.card, new Date()))) return false;
        if (!online && studyFilter === 'mistakes' && !Object.entries(data.states).some(([id, state]) => id.startsWith(`${item.id}:`) && state.flag === 'mistake')) return false;
        if (!known.has(item.id)) { if (newCount >= allowance) return false; newCount++; }
        return true;
      });
      if (!eligible.length) { setMessage(studyFilter === 'due' ? '当前范围没有到期词条。' : allowance === 0 ? '今天的新词目标已完成，可以复习已学内容。' : '这个范围暂无可练习内容，看看词条的缺项说明。'); return; }
      data = { ...data, items: eligible, total: eligible.length };
      await offlineStore.saveDraft(bootstrap.user.id, 'active-session-data', data);
      setStudy({ data, direction, limit: roundSize, random }); setResume(null); setDownloadProgress('');
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); setDownloadProgress(''); }
  }
  async function continueSaved() {
    if (!bootstrap || !resume) return;
    try {
      const data = await offlineStore.getDraft<ItemsResponse>(bootstrap.user.id, 'active-session-data') || { items: [], states: {}, total: 0 };
      const itemIds = data.items.map(item => item.id);
      for (const id of await offlineStore.getResetCardIds(bootstrap.user.id, itemIds)) delete data.states[id];
      Object.assign(data.states, await offlineStore.getStates(bootstrap.user.id, itemIds));
      setStudy({ data, session: resume, direction, limit: roundSize, random });
    } catch (caught) { setError(errorMessage(caught)); }
  }
  async function closeStudy() {
    setStudy(null); if (!bootstrap) return;
    setResume(await offlineStore.loadSession(bootstrap.user.id)); await refreshCounts(bootstrap.user.id);
    if (navigator.onLine) { try { await refresh(); } catch { /* saved local progress remains available */ } }
  }
  async function downloadSelection() {
    if (!bootstrap || !selected.length || busy) return; setBusy(true); setError('');
    try { if (!navigator.onLine) throw new Error('下载课次需要联网。'); const result = await selectionData(); await offlineStore.cacheSelection(bootstrap.user.id, scopeKey(selected), result); await savePreferences(); await ensureOfflineShellReady(); setMessage(`已下载 ${result.items.length} 条内容，可在本机离线练习。`); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); setDownloadProgress(''); }
  }
  async function saveScope() {
    if (!bootstrap || !selected.length) return;
    const name = selected.length === 1 ? `第 ${selected[0].split('-')[0]} 册 · 第 ${selected[0].split('-')[1]} 课` : `${selected.length} 个课次的学习范围`;
    const next = [...scopes.filter(scope => scopeKey(scope.lessonIds) !== scopeKey(selected)), { name, lessonIds: [...selected] }].slice(-8);
    await offlineStore.saveDraft(bootstrap.user.id, 'saved-scopes', next); setScopes(next); setMessage('已收藏这个学习范围，保存在当前账号的本机记录中。');
  }

  if (loading) return <div className="app-loading"><span className="brand-mark">с</span><p>准备你的学习空间…</p></div>;
  if (!bootstrap) return <><AuthPanel demoMode={demoMode} onSuccess={async () => { localStorage.removeItem('slovo:pending-signout'); setError(''); await refresh(); }} />{error && <div className="auth-error notice notice-error" role="alert">{error}</div>}{message && <div className="toast" role="status">{message}</div>}</>;
  const currentBook = bootstrap.books.find(book => book.id === activeBook) || bootstrap.books[0];
  const selectedSummary = selected.length ? `${new Set(selected.map(id => id.split('-')[0])).size} 册 · ${selected.length} 个课次` : '尚未选择课次';
  const stats = dailyStatsFor(bootstrap.stats, bootstrap.user.timeZone, now);
  const goalProgress = Math.min(100, (stats.newToday ?? 0) / goal * 100);
  return <MotionConfig reducedMotion="user"><div className={`app-shell ${study ? 'is-studying' : ''}`}>
    <a className="skip-link" href="#main">跳到主要内容</a><aside className="sidebar"><button className="brand" onClick={() => { setStudy(null); setView('today'); }}><span className="brand-mark">с</span><span><strong>俄语拾词</strong><span>SLOVO</span></span></button><nav aria-label="主要导航">{navigation.map(item => <button key={item.id} className={view === item.id && !study ? 'active' : ''} onClick={() => { setStudy(null); setView(item.id); }}><item.icon size={21} /><span>{item.label}</span>{item.id === 'today' && stats.due > 0 && <small>{stats.due}</small>}</button>)}</nav><div className="sidebar-note"><Leaf size={27} /><p>词语慢慢积累，<br />世界慢慢展开。</p><span>ПОНЕМНОГУ, КАЖДЫЙ ДЕНЬ</span></div><div className="sidebar-user"><span className="avatar small-avatar">{bootstrap.user.name.slice(0, 1)}</span><div><strong>{bootstrap.user.name}</strong><small>{bootstrap.demoMode ? '演示学习空间' : '我的学习空间'}</small></div></div></aside>
    <div className="app-main"><header className="mobile-header"><button className="mobile-brand" onClick={() => { setStudy(null); setView('today'); }}><span className="brand-mark">с</span><strong>俄语拾词</strong></button><span className={`connection-label ${!online ? 'offline' : ''}`}>{!online ? <><WifiOff size={15} />离线</> : syncing ? <><RefreshCw size={14} className="spin" />同步中</> : counts.pending ? `${counts.pending} 条待同步` : '记录已同步'}</span></header>
      <main id="main" ref={mainRef} tabIndex={-1}>
      {!online && <div className="offline-banner"><WifiOff size={17} /><span>正在离线学习。已下载内容可用，联网后同步记录。</span></div>}
      {error && <div className="notice notice-error global-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={18} /></button></div>}
      {study ? <StudyPanel key={study.session?.id || 'new-session'} userId={bootstrap.user.id} items={study.data.items} states={study.data.states} direction={study.direction} limit={study.limit} random={study.random} initialSession={study.session} onClose={() => void closeStudy()} onDetail={setDetail} onSync={sync} onMessage={setMessage} /> : <motion.div initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.18 }} key={view}>
      {view === 'today' && <section><PageTitle eyebrow={new Intl.DateTimeFormat('zh-CN', { timeZone: bootstrap.user.timeZone, month: 'long', day: 'numeric', weekday: 'long' }).format(now)} title="今天，让几个词更熟悉。" description={`你好，${bootstrap.user.name}。从上次停下的地方，继续。`} action={<span className="streak-badge"><Flame size={17} />连续 {stats.streak} 天</span>} />
        <div className="today-layout"><div className="learning-hero"><div className="hero-copy"><p className="eyebrow">МАЛЕНЬКИЕ ШАГИ</p><h2>每一次回想，<br />都算数。</h2><p>{selectedSummary}<br />{resume && nextQuestion(resume) ? `上次学到第 ${resume.cursor + 1} 题，为你保留了位置。` : '先复习，再认识新词。按自己的节奏来。'}</p><Button busy={busy} onClick={() => resume && nextQuestion(resume) ? void continueSaved() : void startStudy()}>{resume && nextQuestion(resume) ? '继续上次学习' : '开始今日学习'}<ArrowRight size={20} /></Button>{resume && nextQuestion(resume) && <button className="hero-new-session" onClick={() => void startStudy()}>重新开始一轮</button>}</div><div className="hero-type" aria-hidden="true"><span>сло</span><span>во<span className="hero-dot">.</span></span><small>一个词，一小步。</small></div></div>
        <div className="goal-card"><div className="section-heading"><h3>今天的新词</h3><button className="icon-button" aria-label="学习设置" onClick={() => setOptions(true)}><Settings2 size={18} /></button></div><div className="goal-number"><strong>{stats.newToday ?? 0}</strong><span>/ {goal}</span></div><div className="progress-track"><span style={{ width: `${goalProgress}%` }} /></div><p className="small muted">新词按学习项目计数，反向卡与错词再练不重复计算。</p><div className="goal-footer"><span>{stats.today} 次</span><small>今日作答，含再练</small></div></div></div>
        <div className="review-grid"><button className="review-tile" onClick={() => void startStudy('due')} disabled={busy}><div className="tile-icon"><RefreshCw size={21} /></div><div><strong>到期复习</strong><p>和已经见过的词，再见一面。</p></div><span className="tile-number">{stats.due}</span><ChevronRight size={20} /></button><button className="review-tile" onClick={() => void startStudy('mistakes')} disabled={busy}><div className="tile-icon warm"><Bookmark size={21} /></div><div><strong>错词再练</strong><p>把还不熟悉的地方，慢慢补上。</p></div><span className="tile-number">{stats.mistakes}</span><ChevronRight size={20} /></button></div>
        <section className="current-course"><div className="section-heading"><h2>继续你的教材</h2><TextLink onClick={() => setView('textbooks')}>调整课次</TextLink></div><div className="course-summary"><div className="book-mini"><span>东方<br />俄语</span><small>РУССКИЙ ЯЗЫК</small></div><div><p className="eyebrow">东方俄语 · 第 1–6 册</p><h3>{selectedSummary}</h3><p className="muted">按课次积累，也可以跨册组合。</p></div><Button variant="secondary" onClick={() => setView('textbooks')}>查看教材<ArrowRight size={17} /></Button></div></section>
        <div className="today-foot"><span><Leaf size={18} />已开始学习 {stats.learned} 个词</span><p>一次选对只是开始，间隔复习让记忆更稳。</p></div>
      </section>}
      {view === 'textbooks' && <section><PageTitle eyebrow="跟着教材，循序积累" title="这一页，从哪里开始？" description="选择一课、多课，或自由组合不同册次。" action={<Button variant="secondary" onClick={() => setOptions(true)}><Settings2 size={18} />学习设置</Button>} />
        <div className="book-tabs" role="tablist" aria-label="教材册数">{bootstrap.books.map(book => <button key={book.id} role="tab" aria-selected={book.id === activeBook} className={`book-tab book-color-${book.id % 3} ${activeBook === book.id ? 'active' : ''}`} onClick={() => setActiveBook(book.id)}><span>东方俄语</span><strong>0{book.id}</strong><small>{book.entryCount.toLocaleString()} 条源词条</small></button>)}</div>
        {currentBook && <section className="lesson-section"><div className="section-heading"><h2>第 {currentBook.id} 册 <span className="muted small">{currentBook.lessons.length} 课</span></h2><button className="text-link" onClick={() => { const all = currentBook.lessons.map(lesson => lesson.id); const every = all.every(id => selected.includes(id)); setSelected(every ? selected.filter(id => !all.includes(id)) : [...new Set([...selected, ...all])]); }}>{currentBook.lessons.every(lesson => selected.includes(lesson.id)) ? '取消整册' : '选择整册'}</button></div><div className="lesson-grid">{currentBook.lessons.map(lesson => <button key={lesson.id} className={`lesson-chip ${selected.includes(lesson.id) ? 'selected' : ''}`} aria-pressed={selected.includes(lesson.id)} onClick={() => setSelected(current => current.includes(lesson.id) ? current.filter(id => id !== lesson.id) : [...current, lesson.id])}><span>第 {lesson.number} 课</span><small>{lesson.count} 条 · {lesson.eligibleCount} 可练</small><span className="selection-check">{selected.includes(lesson.id) && <Check size={13} />}</span></button>)}</div></section>}
        {scopes.length > 0 && <div className="saved-scopes"><span className="small muted">本机收藏范围</span>{scopes.map((scope, index) => <button className="tag-button" key={`${scope.name}:${index}`} onClick={() => setSelected(scope.lessonIds)}><Bookmark size={13} />{scope.name}</button>)}</div>}
        <div className="selection-bar"><div><strong>已选 {selected.length} 个课次</strong><button className="text-link small" disabled={!selected.length} onClick={() => setSelected([])}>清空</button></div><div className="toolbar"><button className="icon-button" aria-label="收藏当前学习范围" disabled={!selected.length} onClick={() => void saveScope()}><Bookmark size={18} /></button><Button variant="secondary" busy={busy} disabled={!selected.length} onClick={() => void downloadSelection()}><Download size={17} />下载离线</Button><Button busy={busy} disabled={!selected.length} onClick={() => void startStudy()}>开始学习<ArrowRight size={17} /></Button></div></div>
        {downloadProgress && <p role="status" className="small muted">正在读取 {downloadProgress}</p>}
        <div className="library-tools"><label className="search-field"><Search size={18} /><input aria-label="搜索俄语、中文或词形" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索俄语、中文、词组或词形" /></label><label className="filter-field"><span className="sr-only">词条状态</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部词条</option><option value="new">新词</option><option value="learning">学习中</option><option value="due">到期复习</option><option value="mistakes">错词</option><option value="favorites">收藏</option><option value="suspended">已暂停</option></select></label></div>
        <div className="section-heading list-heading"><h3>{selected.length ? '所选范围' : `第 ${activeBook} 册词条`}</h3><span className="small muted">{list.total} 个学习项目 · 一词可有多张方向卡</span></div><WordList items={list.items} loading={listLoading} total={list.total} onMore={() => void loadList(true)} onItem={setDetail} />
        <p className="coverage-note">词条完整导入当前工作簿，来源覆盖说明可在“我的”查看。多课归属共用同一学习项目；缺释义与实质争议会标记，不用于不适合的题型。</p>
      </section>}
      {view === 'decks' && <DecksPanel userId={bootstrap.user.id} onStudy={deckId => void startStudy('all', deckId)} onDetail={setDetail} onMessage={setMessage} />}
      {view === 'profile' && <ProfilePanel bootstrap={{ ...bootstrap, stats }} pending={counts.pending} conflicts={counts.conflicts} onSync={sync} onLogout={logout} onRefresh={refresh} onMessage={setMessage} />}
      </motion.div>}
      </main>
    </div>
    {!study && <nav className="bottom-navigation" aria-label="手机主要导航">{navigation.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)} aria-current={view === item.id ? 'page' : undefined}><item.icon size={21} /><span>{item.label}</span></button>)}</nav>}
    {options && <Modal title="按你的节奏学习" onClose={() => setOptions(false)}><label>每日新词目标<select value={goal} onChange={event => setGoal(Number(event.target.value))}>{[5, 10, 15, 20, 30, 50].map(value => <option key={value} value={value}>{value} 个新词</option>)}</select></label><label>每轮题数<select value={roundSize} onChange={event => setRoundSize(Number(event.target.value))}>{[5, 10, 20, 30, 50].map(value => <option key={value} value={value}>{value} 题（错词再练另计）</option>)}</select></label><label>练习方向<select value={direction} onChange={event => setDirection(event.target.value as Direction | 'mixed')}><option value="mixed">双向练习</option><option value="ru-zh">俄语选中文</option><option value="zh-ru">中文选俄语</option><option value="recall">自主回忆翻卡</option></select></label><label>词条顺序<select value={random ? 'random' : 'ordered'} onChange={event => setRandom(event.target.value === 'random')}><option value="ordered">按教材顺序</option><option value="random">随机顺序</option></select></label><label>复习范围<select value={reviewScope} onChange={event => setReviewScope(event.target.value as 'selection' | 'all')}><option value="selection">仅当前选课范围</option><option value="all">我的全部词库</option></select></label><p className="small muted">反向卡分别记录进度。词库较小或选项有歧义时，自动使用自主回忆。</p><Button className="full-width" onClick={() => { void savePreferences().then(() => { setOptions(false); setMessage('学习设置已保存。'); }).catch(caught => setError(errorMessage(caught))); }}>保存设置</Button></Modal>}
    {detail && <ItemDetail initial={detail} onClose={() => setDetail(null)} onMessage={setMessage} onChanged={() => { if (view === 'textbooks') void loadList(); }} />}
    {message && <div className="toast" role="status"><span>{message}</span><button className="icon-button" aria-label="关闭消息" onClick={() => setMessage('')}><X size={17} /></button></div>}
  </div></MotionConfig>;
}
