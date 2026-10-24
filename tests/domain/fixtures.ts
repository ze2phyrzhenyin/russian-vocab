import type { BootstrapDTO, LearningItemDTO, ReviewEventInput } from '../../src/domain/types';
import { PARAMETERS_VERSION, SCHEDULER_VERSION } from '../../src/domain/learning';

export function item(id: string, russian = `слово-${id}`, chinese = `意义-${id}`): LearningItemDTO {
  return { id, russian, chinese, searchKey: russian, kind: 'word', morphology: '', notes: '', book: 1, lessons: [1],
    sourceEntryId: id, documentId: 'book-1', bookPage: '12', pdfPage: '14', assetIds: [], missingMeaning: false,
    disputed: false, contentVersion: 1, annotations: null };
}
export const wordSet = [item('a', 'мама', '妈妈'), item('b', 'вода', '水'), item('c', 'стол', '桌子'), item('d', 'дом', '房子'), item('e', 'книга', '书'), item('f', 'хлеб', '面包'), item('g', 'солнце', '太阳'), item('h', 'город', '城市'), item('i', 'море', '海'), item('j', 'ночь', '夜晚')];
export const now = new Date('2026-10-24T12:00:00.000Z');
export function bootstrap(userId = 'alice'): BootstrapDTO {
  return { user: { id: userId, name: userId, email: `${userId}@example.test`, role: 'user', timeZone: 'Asia/Shanghai' },
    demoMode: true, stats: { learned: 0, due: 0, mistakes: 0, today: 0, streak: 0 }, selection: { lessonIds: ['1-1'], dailyGoal: 10 }, books: [] };
}
export function event(index: number, overrides: Partial<ReviewEventInput> = {}): ReviewEventInput {
  return { id: `event-${index}`, deviceId: 'device-a', sessionId: 'session-a', clientSequence: index,
    cardId: `item-${index}:ru-zh`, itemId: `item-${index}`, direction: 'ru-zh', rating: 'good', correct: true,
    practice: false, occurredAt: now.toISOString(), baseVersion: 0, contentVersion: 1,
    schedulerVersion: SCHEDULER_VERSION, parametersVersion: PARAMETERS_VERSION, ...overrides };
}
