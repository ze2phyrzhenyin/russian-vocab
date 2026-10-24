'use client';

import { ChevronRight, Bookmark, Pause } from 'lucide-react';
import type { LearningItemDTO } from '../domain/types';
import { EmptyState } from './ui';

export default function WordList({ items, onItem, loading = false, total, onMore }: { items: LearningItemDTO[]; onItem: (item: LearningItemDTO) => void; loading?: boolean; total?: number; onMore?: () => void }) {
  if (loading && !items.length) return <div className="word-list" aria-busy="true">{[1, 2, 3, 4].map(id => <div className="word-skeleton skeleton" key={id} />)}</div>;
  if (!items.length) return <EmptyState title="这里还没有词条">换个关键词或筛选条件试试。</EmptyState>;
  return <><div className="word-list">{items.map(item => <button key={item.id} className="word-row" onClick={() => onItem(item)}><span className="word-text"><strong lang="ru">{item.russian}</strong><span>{item.missingMeaning ? '尚缺中文释义' : item.chinese}</span><small>{item.book ? `第 ${item.book} 册 · 第 ${item.lessons.join('、')} 课` : '个人词库'}{item.disputed ? ' · 有待核查项' : ''}{item.morphology ? ` · ${item.morphology}` : ''}</small></span><span className="word-icons">{item.favorite && <Bookmark size={16} />}{item.suspended && <Pause size={16} />}<ChevronRight size={19} /></span></button>)}</div>{onMore && (total ?? 0) > items.length && <button className="button button-secondary load-more" onClick={onMore} disabled={loading}>{loading ? '正在加载…' : `继续查看（已显示 ${items.length} / ${total}）`}</button>}</>;
}
