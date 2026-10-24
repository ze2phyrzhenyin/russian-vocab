import { createAuthClient } from 'better-auth/react';
import type { BootstrapDTO, DeckDTO, ItemsResponse, LearningItemDTO, SyncResponse, ReviewEventInput } from '../domain/types';

export const authClient = createAuthClient();
let expectedUser: string | null = null;
export function setExpectedUser(userId: string | null) { expectedUser = userId; }
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase();
  const sendsJson = Boolean(init?.body) || !['GET', 'HEAD'].includes(method);
  const response = await fetch(path, {
    ...init, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(sendsJson ? { 'Content-Type': 'application/json' } : {}), ...(expectedUser ? { 'X-Slovo-User': expectedUser } : {}), ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof body.error === 'string' ? body.error : body.message || (response.status === 401 ? '登录已过期，请重新登录后同步。' : '暂时无法完成，请重试。'), response.status);
  return body as T;
}
export const api = {
  config: () => request<{ demoMode: boolean }>('/api/config'),
  bootstrap: () => request<BootstrapDTO>('/api/bootstrap'),
  items: (parameters: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams();
    Object.entries(parameters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
    return request<ItemsResponse>(`/api/items?${query}`);
  },
  item: (id: string) => request<{ item: LearningItemDTO; revisions: unknown[] }>(`/api/items/${encodeURIComponent(id)}`),
  preferences: (body: unknown) => request('/api/preferences', { method: 'POST', body: JSON.stringify(body) }),
  reviews: (events: ReviewEventInput[]) => request<SyncResponse>('/api/reviews', { method: 'POST', body: JSON.stringify({ events }) }),
  decks: () => request<{ decks: DeckDTO[] }>('/api/decks'),
};
export async function fetchAllItems(parameters: Record<string, string | number | undefined>, onProgress?: (loaded: number, total: number) => void): Promise<ItemsResponse> {
  const result: ItemsResponse = { items: [], states: {}, total: 0 };
  for (;;) {
    const page = await api.items({ ...parameters, offset: result.items.length, limit: 500 });
    result.total = page.total;
    if (!page.items.length && result.items.length < page.total) throw new Error('词条尚未完整载入，请重试。');
    result.items.push(...page.items); Object.assign(result.states, page.states); onProgress?.(result.items.length, result.total);
    if (result.items.length >= result.total || !page.items.length) return result;
    if (result.items.length > 20000) throw new Error('当前学习范围过大，请按课次下载。');
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '暂时无法完成，请重试。';
}
export function downloadJson(name: string, content: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
