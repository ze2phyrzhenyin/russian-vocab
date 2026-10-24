import { describe, expect, it } from 'vitest';
import { adaptRating, answerSession, applyRating, buildQuestions, cardId, dailyStatsFor, distractorIsSafe, isDue, localDateKey, makeSession, nextQuestion, sessionSummary, studyStreak } from '../../src/domain/learning';
import { hasMixedAlphabet, matchesSearch, normalizeSearch, searchAliases } from '../../src/domain/search';
import { item, now, wordSet } from './fixtures';

describe('Russian normalization', () => {
  it('removes only stress while retaining decomposed ё and й', () => {
    expect(normalizeSearch('ЁЛКА й Е\u0308 и\u0306 мо\u0301ре')).toBe('ёлка й ё й море');
    expect(searchAliases('ёлка')).toEqual(['ёлка', 'елка']);
    expect(matchesSearch('елка', 'ёлка')).toBe(true);
    expect(matchesSearch('и', 'й')).toBe(false);
    expect(normalizeSearch('е\u0323')).toContain('\u0323');
  });
  it('flags mixed alphabet tokens without rewriting text', () => {
    expect(hasMixedAlphabet('мoре')).toBe(true); expect(hasMixedAlphabet('море test')).toBe(false);
  });
});

describe('versioned FSRS scheduling', () => {
  it('keeps direction states independent and computes deterministic due times', () => {
    const forward = applyRating(null, 'good', now); const reverse = applyRating(null, 'again', now);
    expect(cardId('x', 'ru-zh')).not.toBe(cardId('x', 'zh-ru'));
    expect(forward).toEqual(applyRating(null, 'good', now));
    expect(forward.reps).toBe(1); expect(reverse.reps).toBe(1);
    expect(new Date(forward.due).getTime()).toBeGreaterThan(new Date(reverse.due).getTime());
    expect(isDue(forward, new Date(new Date(forward.due).getTime() - 1))).toBe(false);
    expect(isDue(forward, forward.due)).toBe(true);
  });
  it('advances steps only on real scheduling calls and rejects reversed time', () => {
    const first = applyRating(null, 'good', now);
    const second = applyRating(JSON.parse(JSON.stringify(first)), 'good', first.due);
    const third = applyRating(second, 'good', second.due);
    expect(second.reps).toBe(2); expect(third.scheduled_days).toBeGreaterThan(second.scheduled_days);
    expect(() => applyRating(second, 'good', now)).toThrow(/precedes/);
    expect(() => applyRating({ ...first, stability: Number.NaN }, 'good', first.due)).toThrow(/Invalid/);
  });
  it('never records a wrong or hinted answer as Hard/Good/Easy', () => {
    expect(adaptRating({ correct: false, rating: 'hard' })).toBe('again');
    expect(adaptRating({ correct: true, hinted: true, rating: 'easy' })).toBe('again');
    expect(adaptRating({ correct: true, guessed: true })).toBe('again');
    expect(adaptRating({ correct: true, rating: 'hard' })).toBe('hard');
  });
});

describe('questions and bounded mistake queue', () => {
  it('builds real choices in both directions without adjacent siblings', () => {
    const questions = buildQuestions(wordSet, 'mixed', { limit: 20, now });
    expect(questions).toHaveLength(20);
    expect(new Set(questions.map((q) => q.direction))).toEqual(new Set(['ru-zh', 'zh-ru']));
    expect(questions.every((q, i) => i === 0 || q.itemId !== questions[i - 1].itemId)).toBe(true);
    expect(questions.every((q) => q.mode === 'choice')).toBe(true);
    expect(questions.every((q) => q.options.filter((option) => option.id === q.correctOptionId).length === 1)).toBe(true);
    expect(questions.every((q) => new Set(q.options.map((option) => normalizeSearch(option.text))).size === q.options.length)).toBe(true);
  });
  it('balances a limited mixed round even when the deck is much larger', () => {
    const questions = buildQuestions(wordSet, 'mixed', { limit: 6, now });
    expect(questions.filter((q) => q.direction === 'ru-zh')).toHaveLength(3);
    expect(questions.filter((q) => q.direction === 'zh-ru')).toHaveLength(3);
    expect(questions.every((q, i) => i === 0 || q.itemId !== questions[i - 1].itemId)).toBe(true);
    const tinyRound = buildQuestions(wordSet, 'mixed', { limit: 2, now });
    expect(new Set(tinyRound.map((q) => q.direction)).size).toBe(2);
    expect(tinyRound[0].itemId).not.toBe(tinyRound[1].itemId);
  });
  it('does not offer missing, synonymous, aspect variants or meaning-disputed answers', () => {
    const target = item('x', 'смотреть', '看');
    expect(distractorIsSafe(target, item('y', 'глядеть', '观看'))).toBe(false);
    expect(distractorIsSafe(item('x', 'писать // написать', '写'), item('y', 'написать', '写完'))).toBe(false);
    expect(distractorIsSafe(target, { ...wordSet[0], missingMeaning: true })).toBe(false);
    expect(distractorIsSafe(target, { ...wordSet[0], meaningDisputed: true })).toBe(false);
    const questions = buildQuestions([...wordSet, { ...item('missing'), chinese: '（原表未提供中文释义）' }, { ...item('disputed'), meaningDisputed: true }], 'ru-zh', { limit: 30, now });
    expect(questions.some((q) => q.itemId === 'missing' || q.itemId === 'disputed')).toBe(false);
    expect(questions.flatMap((q) => q.options).some((option) => option.text.includes('未提供'))).toBe(false);
  });
  it('allows reliable meaning on an aspect-flagged item', () => {
    const questions = buildQuestions([{ ...wordSet[0], disputed: true }, ...wordSet.slice(1)], 'ru-zh', { now });
    expect(questions[0].mode).toBe('choice');
  });
  it('supports one and two items with explicit recall degradation', () => {
    for (const count of [1, 2]) {
      const questions = buildQuestions(wordSet.slice(0, count), 'mixed', { now });
      expect(questions).toHaveLength(count); expect(questions.every((q) => q.mode === 'recall')).toBe(true);
      let session = makeSession(questions, `small-${count}`);
      for (let guard = 0; nextQuestion(session) && guard < 20; guard++) {
        session = answerSession(session, { questionId: nextQuestion(session)!.question.id, correct: false, now }).session;
      }
      expect(sessionSummary(session).completed).toBe(true);
      expect(sessionSummary(session).hard).toBeGreaterThan(0);
      expect(session.answers.length).toBeLessThanOrEqual(count * 3);
    }
  });
  it('separates delayed correction practice from the first scheduling event', () => {
    const initial = makeSession(buildQuestions(wordSet, 'ru-zh', { now }), 'queue');
    const firstQuestion = nextQuestion(initial)!.question;
    const result = answerSession(initial, { questionId: firstQuestion.id, correct: false, now });
    expect(result.attempt.rating).toBe('again'); expect(result.attempt.practice).toBe(false);
    const retryIndex = result.session.queue.findIndex((entry) => entry.attempt === 1);
    expect(retryIndex).toBeGreaterThanOrEqual(4); expect(retryIndex).toBeLessThanOrEqual(8);
    let session = result.session;
    while (session.cursor < retryIndex) session = answerSession(session, { questionId: nextQuestion(session)!.question.id, correct: true, now }).session;
    const retry = answerSession(session, { questionId: nextQuestion(session)!.question.id, correct: true, now });
    expect(retry.attempt.practice).toBe(true);
    expect(sessionSummary(retry.session).corrected).toBe(1);
    expect(() => answerSession(result.session, { questionId: firstQuestion.id, correct: true, now })).toThrow(/already/);
  });
  it('terminates when all answers are wrong and marks not-due exposures as practice', () => {
    const card = applyRating(null, 'good', now);
    let session = makeSession(buildQuestions(wordSet, 'ru-zh', { now, states: { 'a:ru-zh': { card, version: 1 } } }), 'bounded');
    expect(nextQuestion(session)!.practice).toBe(true);
    let attempts = 0;
    while (nextQuestion(session) && attempts < 100) {
      session = answerSession(session, { questionId: nextQuestion(session)!.question.id, correct: false, now }).session; attempts++;
    }
    expect(nextQuestion(session)).toBeUndefined(); expect(attempts).toBeLessThanOrEqual(wordSet.length * 3);
    expect(session.hardItemIds.length).toBeGreaterThan(0);
  });
});

describe('user calendar boundaries', () => {
  it('keeps daily counts through repeated DST hours but resets at the actual local midnight', () => {
    const stats = { day: '2026-10-25', today: 15, newToday: 10, learned: 30, due: 2, mistakes: 1, streak: 4 };
    expect(dailyStatsFor(stats, 'Europe/Paris', '2026-10-25T00:30:00Z').newToday).toBe(10);
    expect(dailyStatsFor(stats, 'Europe/Paris', '2026-10-25T01:30:00Z').newToday).toBe(10);
    expect(dailyStatsFor(stats, 'Europe/Paris', '2026-10-25T22:59:59Z').today).toBe(15);
    expect(dailyStatsFor(stats, 'Europe/Paris', '2026-10-25T23:00:00Z')).toMatchObject({ day: '2026-10-26', today: 0, newToday: 0, learned: 30 });
    expect(dailyStatsFor({ ...stats, day: '2026-03-29' }, 'Europe/Paris', '2026-03-29T21:59:59Z').today).toBe(15);
    expect(dailyStatsFor({ ...stats, day: '2026-03-29' }, 'Europe/Paris', '2026-03-29T22:00:00Z').today).toBe(0);
  });

  it('uses user timezone, not server midnight, with deterministic DST dates', () => {
    expect(localDateKey('2026-10-24T16:00:00Z', 'Asia/Shanghai')).toBe('2026-10-25');
    expect(localDateKey('2026-10-25T00:30:00Z', 'Europe/Paris')).toBe('2026-10-25');
    expect(localDateKey('2026-10-25T01:30:00Z', 'Europe/Paris')).toBe('2026-10-25');
    expect(studyStreak(['2026-03-28T11:00:00Z', '2026-03-29T10:00:00Z'], '2026-03-30T08:00:00Z', 'Europe/Paris')).toBe(2);
    expect(studyStreak(['2026-03-27T11:00:00Z', '2026-03-29T10:00:00Z'], '2026-03-30T08:00:00Z', 'Europe/Paris')).toBe(1);
  });
});
