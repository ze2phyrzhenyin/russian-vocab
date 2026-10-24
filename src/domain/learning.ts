import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { CardStateDTO, Direction, LearningItemDTO, RatingName, SerializedCard, StatsDTO } from './types';
import { normalizeSearch } from './search';

export type { Direction, RatingName, SerializedCard } from './types';
export const SCHEDULER_VERSION = 'ts-fsrs@5.4.2/fsrs-6';
export const PARAMETERS_VERSION = 'slovo-fsrs6-v1';

/** Answer accuracy and memory failure are separate: hinted/Again remains a mistake. */
export function isMistake(event: { correct: boolean; rating: string }): boolean {
  return !event.correct || event.rating === 'again';
}

/** Cached day totals expire at the user's calendar midnight, including DST days. */
export function dailyStatsFor(stats: StatsDTO, timeZone: string, now: Date | string = new Date()): StatsDTO {
  const day = localDateKey(now, timeZone);
  return stats.day && stats.day !== day ? { ...stats, day, today: 0, newToday: 0 } : { ...stats, day };
}
// Published FSRS-6 defaults pinned with application parameters, not mutable library defaults.
export const SCHEDULER_PARAMETERS = {
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['1m', '10m'] as const,
  relearning_steps: ['10m'] as const,
  w: [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542],
};
const scheduler = fsrs(SCHEDULER_PARAMETERS);
const grades: Record<RatingName, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

export function cardId(itemId: string, direction: Direction): string { return `${itemId}:${direction}`; }

function validDate(value: string | Date): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid review time');
  return date;
}

export function deserializeCard(value: SerializedCard): Card {
  const numberFields = ['stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses', 'learning_steps'] as const;
  if (numberFields.some((field) => !Number.isFinite(value[field]) || value[field] < 0)
    || ![State.New, State.Learning, State.Review, State.Relearning].includes(value.state)) throw new Error('Invalid saved card');
  return { ...value, state: value.state as State, due: validDate(value.due), last_review: value.last_review ? validDate(value.last_review) : undefined };
}

export function serializeCard(card: Card): SerializedCard {
  return { ...card, due: card.due.toISOString(), last_review: card.last_review?.toISOString() };
}

export function applyRating(card: SerializedCard | null | undefined, rating: RatingName, now: Date | string): SerializedCard {
  const at = validDate(now);
  if (!(rating in grades)) throw new Error('Unknown review rating');
  const before = card ? deserializeCard(card) : createEmptyCard(at);
  if (before.last_review && at < before.last_review) throw new Error('Review time precedes existing history');
  return serializeCard(scheduler.next(before, at, grades[rating]).card);
}

export function isDue(card: SerializedCard | null | undefined, now: Date | string): boolean {
  return !card || validDate(card.due).getTime() <= validDate(now).getTime();
}

/** Incorrect/forgotten is always Again. Hints and guessing cannot become Easy. */
export function adaptRating(input: { correct: boolean; rating?: RatingName; hinted?: boolean; guessed?: boolean }): RatingName {
  if (!input.correct || input.rating === 'again') return 'again';
  if (input.hinted || input.guessed) return 'again';
  return input.rating ?? 'good';
}

export interface StudyQuestion {
  id: string; itemId: string; cardId: string; direction: Direction;
  mode: 'choice' | 'recall'; prompt: string; answer: string;
  options: { id: string; text: string }[]; correctOptionId: string | null;
  explanation: string; contentVersion: number; fallbackReason?: string; initialPractice: boolean;
}
export interface BuildOptions { limit?: number; seed?: string; shuffle?: boolean; states?: Record<string, CardStateDTO>; now?: Date }

function hash(value: string): number {
  let h = 2166136261;
  for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function seededShuffle<T>(values: readonly T[], seed: string): T[] {
  const result = [...values]; let state = hash(seed) || 1;
  for (let i = result.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const j = (state >>> 0) % (i + 1); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const MISSING_MEANING = /原表未提供中文释义|暂无释义|待补译|^\s*$/;
const equivalences = [
  ['看', '观看', '瞧'], ['说', '讲', '讲话'], ['工作', '劳动'], ['美丽', '漂亮', '好看'],
  ['大', '巨大'], ['小', '微小'], ['快', '迅速'], ['高兴', '快乐', '愉快'],
  ['朋友', '友人'], ['父亲', '爸爸'], ['母亲', '妈妈'], ['孩子', '儿童'],
  ['此处', '这里'], ['那里', '彼处'], ['现在', '此刻'], ['房子', '房屋'],
];
function meaningAtoms(value: string): string[] {
  return normalizeSearch(value).replace(/（[^）]*）|\([^)]*\)/g, '')
    .split(/[，,；;、/\n]+/).map((atom) => atom.replace(/^\d+[.、)）]?\s*/, '').trim()).filter(Boolean);
}
function russianAtoms(value: string): string[] {
  return normalizeSearch(value).split(/\s*\/\/?\s*|\s*;\s*/).map((part) => part.trim()).filter(Boolean);
}
function overlaps(a: string[], b: string[], meanings = false): boolean {
  return a.some((left) => b.some((right) => left === right || (meanings && (left.includes(right) || right.includes(left)
    || equivalences.some((group) => group.includes(left) && group.includes(right))))));
}

/** Deterministic exclusions; uncertain multi-meaning/pair entries use self-recall. */
export function distractorIsSafe(target: LearningItemDTO, candidate: LearningItemDTO): boolean {
  if (target.id === candidate.id || candidate.missingMeaning || candidate.meaningDisputed || MISSING_MEANING.test(candidate.chinese)) return false;
  if (overlaps(russianAtoms(target.russian), russianAtoms(candidate.russian))) return false;
  if (overlaps(meaningAtoms(target.chinese), meaningAtoms(candidate.chinese), true)) return false;
  // е/ё aliases are useful for search but too risky as contrasting answer options.
  if (normalizeSearch(target.russian).replace(/ё/g, 'е') === normalizeSearch(candidate.russian).replace(/ё/g, 'е')) return false;
  // Alternatives and pair entries are not used as distractors without lexical review.
  return meaningAtoms(candidate.chinese).length === 1 && russianAtoms(candidate.russian).length === 1;
}

export function buildQuestions(input: LearningItemDTO[], direction: Direction | 'mixed', options: BuildOptions = {}): StudyQuestion[] {
  const seen = new Set<string>();
  const eligible = input.filter((item) => {
    if (seen.has(item.id) || item.suspended || item.missingMeaning || item.meaningDisputed || MISSING_MEANING.test(item.chinese) || !item.russian.trim()) return false;
    seen.add(item.id); return true;
  });
  const seed = options.seed ?? 'slovo-v1';
  const items = options.shuffle ? seededShuffle(eligible, seed) : eligible;
  const limit = Math.min(500, Math.max(0, options.limit ?? 20));
  const now = options.now ?? new Date();
  const plan: { item: LearningItemDTO; direction: Direction }[] = [];
  if (direction === 'mixed' && items.length >= 3) {
    const count = Math.min(limit, items.length * 2);
    const firstCount = Math.ceil(count / 2);
    plan.push(...items.slice(0, firstCount).map((item) => ({ item, direction: 'ru-zh' as const })));
    const secondItems = firstCount === 1 ? items.slice(1, 1 + Math.floor(count / 2)) : items.slice(0, Math.floor(count / 2));
    plan.push(...secondItems.map((item) => ({ item, direction: 'zh-ru' as const })));
  } else {
    plan.push(...items.slice(0, limit).map((item) => ({ item, direction: direction === 'mixed' ? 'ru-zh' as const : direction })));
  }
  const questions: StudyQuestion[] = [];
  for (const { item, direction: currentDirection } of plan) {
      const identity = cardId(item.id, currentDirection);
      const reverse = currentDirection === 'zh-ru';
      const question: StudyQuestion = {
        id: `${identity}:first`, itemId: item.id, cardId: identity, direction: currentDirection,
        mode: 'recall', prompt: reverse ? item.chinese : item.russian,
        answer: reverse ? item.russian : item.chinese, options: [], correctOptionId: null,
        explanation: item.notes || (item.morphology ? `教材词性与词形：${item.morphology}` : '本题按教材或个人词库所录义项练习。'),
        contentVersion: item.contentVersion, initialPractice: !isDue(options.states?.[identity]?.card, now),
      };
      const targetAmbiguous = meaningAtoms(item.chinese).length !== 1 || russianAtoms(item.russian).length !== 1;
      if (currentDirection === 'recall') question.fallbackReason = '自主回忆';
      else if (items.length <= 2) question.fallbackReason = '当前词库较小，使用自主回忆，避免互相提示答案。';
      else if (targetAmbiguous) question.fallbackReason = '条目包含多义、体配对或待核查内容，使用自主回忆。';
      else {
        const distractors = seededShuffle(eligible.filter((other) => distractorIsSafe(item, other)), `${seed}:${identity}`)
          .filter((other, index, all) => all.findIndex((test) => normalizeSearch(reverse ? test.russian : test.chinese) === normalizeSearch(reverse ? other.russian : other.chinese)) === index).slice(0, 3);
        if (distractors.length >= 2) {
          const answers = [{ id: item.id, text: question.answer }, ...distractors.map((other) => ({ id: other.id, text: reverse ? other.russian : other.chinese }))];
          question.mode = 'choice'; question.correctOptionId = item.id;
          question.options = seededShuffle(answers, `${seed}:${identity}:options`);
        } else question.fallbackReason = '没有足够明确的干扰项，使用自主回忆。';
      }
      questions.push(question);
  }
  return questions;
}

export interface QueueEntry { question: StudyQuestion; attempt: number; practice: boolean }
export interface StudyAttempt {
  id: string; cardId: string; itemId: string; direction: Direction;
  rating: RatingName; correct: boolean; practice: boolean; occurredAt: string; contentVersion: number;
}
export interface StudySession {
  id: string; queue: QueueEntry[]; cursor: number; answers: StudyAttempt[]; hardItemIds: string[];
}

export function makeSession(questions: StudyQuestion[], sessionId: string): StudySession {
  return { id: sessionId, queue: questions.map((question) => ({ question, attempt: 0, practice: question.initialPractice })), cursor: 0, answers: [], hardItemIds: [] };
}
export function nextQuestion(session: StudySession): QueueEntry | undefined { return session.queue[session.cursor]; }

export function answerSession(session: StudySession, input: { questionId: string; correct: boolean; rating?: RatingName; hinted?: boolean; now?: Date }): { session: StudySession; attempt: StudyAttempt } {
  const current = nextQuestion(session);
  if (!current || current.question.id !== input.questionId) throw new Error('This question has already been answered or changed');
  const attemptId = `${session.id}:${current.question.id}:${current.attempt}`;
  if (session.answers.some((answer) => answer.id === attemptId)) throw new Error('Duplicate answer');
  const rating = adaptRating(input);
  const attempt: StudyAttempt = {
    id: attemptId, cardId: current.question.cardId, itemId: current.question.itemId, direction: current.question.direction,
    rating, correct: input.correct && rating !== 'again', practice: current.practice,
    occurredAt: validDate(input.now ?? new Date()).toISOString(), contentVersion: current.question.contentVersion,
  };
  const queue = [...session.queue]; const hardItemIds = [...session.hardItemIds];
  if (!attempt.correct) {
    if (current.attempt >= 2) {
      if (!hardItemIds.includes(attempt.itemId)) hardItemIds.push(attempt.itemId);
    } else {
      const retryNumber = current.attempt + 1;
      const retry = { ...current, attempt: retryNumber, practice: true, question: {
        ...current.question, id: `${current.question.cardId}:retry-${retryNumber}`,
        options: seededShuffle(current.question.options, `${session.id}:${current.question.cardId}:${retryNumber}`),
      } };
      const remaining = queue.slice(session.cursor + 1);
      // A single-item deck has no safe delay: retain mistake for the next session.
      if (!remaining.some((entry) => entry.question.itemId !== attempt.itemId)) {
        if (!hardItemIds.includes(attempt.itemId)) hardItemIds.push(attempt.itemId);
      } else {
        const gap = 3 + (hash(attempt.id) % 5);
        let insertAt = session.cursor + 1; let different = 0;
        while (insertAt < queue.length && different < gap) {
          if (queue[insertAt].question.itemId !== attempt.itemId) different++;
          insertAt++;
        }
        // Do not put retry directly against a sibling if there is room to defer.
        while (insertAt < queue.length && (queue[insertAt - 1]?.question.itemId === attempt.itemId || queue[insertAt]?.question.itemId === attempt.itemId)) insertAt++;
        if (queue[insertAt - 1]?.question.itemId === attempt.itemId) {
          if (!hardItemIds.includes(attempt.itemId)) hardItemIds.push(attempt.itemId);
        } else queue.splice(insertAt, 0, retry);
      }
    }
  }
  return { session: { ...session, queue, cursor: session.cursor + 1, answers: [...session.answers, attempt], hardItemIds }, attempt };
}

export function sessionSummary(session: StudySession) {
  const formal = session.answers.filter((answer) => !answer.practice);
  return { answered: session.answers.length, formal: formal.length, practice: session.answers.length - formal.length,
    correct: session.answers.filter((answer) => answer.correct).length,
    corrected: new Set(session.answers.filter((answer) => answer.practice && answer.correct).map((answer) => answer.itemId)).size,
    hard: session.hardItemIds.length, completed: session.cursor >= session.queue.length };
}

export function localDateKey(value: Date | string, timeZone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(validDate(value));
  return ['year', 'month', 'day'].map((name) => parts.find((part) => part.type === name)!.value).join('-');
}
export function dateKeyOffset(key: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Invalid day key');
  const date = new Date(`${key}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}
export function studyStreak(dates: (Date | string)[], now: Date | string, timeZone = 'Asia/Shanghai'): number {
  const days = new Set(dates.map((value) => localDateKey(value, timeZone)));
  let key = localDateKey(now, timeZone); if (!days.has(key)) key = dateKeyOffset(key, -1);
  let streak = 0; while (days.has(key)) { streak++; key = dateKeyOffset(key, -1); } return streak;
}
