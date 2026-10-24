'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, Sparkles, X } from 'lucide-react';
import { answerSession, applyRating, buildQuestions, makeSession, nextQuestion, PARAMETERS_VERSION, SCHEDULER_VERSION, type StudySession } from '../domain/learning';
import type { CardStateDTO, Direction, LearningItemDTO, RatingName, ReviewEventInput } from '../domain/types';
import { offlineStore } from '../lib/offline';
import { errorMessage } from '../lib/api-client';
import { Button, SpeechButton } from './ui';

interface Feedback { questionId: string; chosen: string | null; correct: boolean; rating: RatingName; hinted: boolean }
interface Props {
  userId: string; items: LearningItemDTO[]; states: Record<string, CardStateDTO>;
  direction: Direction | 'mixed'; limit: number; random: boolean; initialSession?: StudySession;
  onClose: () => void; onDetail: (item: LearningItemDTO) => void; onSync: () => Promise<void>; onMessage: (message: string) => void;
}
export default function StudyPanel(props: Props) {
  const [session, setSession] = useState(() => props.initialSession || makeSession(buildQuestions(props.items, props.direction, { limit: props.limit, shuffle: props.random, seed: crypto.randomUUID(), states: props.states }), crypto.randomUUID()));
  const [feedback, setFeedback] = useState<Feedback | null>(null); const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [states, setStates] = useState(props.states); const submitting = useRef(false);
  const entry = nextQuestion(session); const question = entry?.question;
  const item = props.items.find(candidate => candidate.id === question?.itemId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    void offlineStore.saveSession(props.userId, session).catch(caught => setError(errorMessage(caught)));
    void offlineStore.getDraft<Feedback>(props.userId, `answer:${session.id}`).then(saved => {
      if (active && saved?.questionId === question?.id) { setFeedback(saved); setRevealed(true); }
    }).catch(() => {});
    return () => { active = false; if ('speechSynthesis' in window) speechSynthesis.cancel(); };
    // A session is created or restored once, then persisted atomically with every attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { heading.current?.focus(); }, [question?.id, session.cursor]);
  async function setAnswer(chosen: string | null, correct: boolean, rating: RatingName = correct ? 'good' : 'again') {
    const value = { questionId: question!.id, chosen, correct, rating, hinted: false };
    setFeedback(value); setRevealed(true);
    try { await offlineStore.saveDraft(props.userId, `answer:${session.id}`, value); } catch (caught) { setError(errorMessage(caught)); }
  }
  function reviseFeedback(patch: Partial<Feedback>) {
    if (!feedback) return; const value = { ...feedback, ...patch }; setFeedback(value);
    void offlineStore.saveDraft(props.userId, `answer:${session.id}`, value).catch(caught => setError(errorMessage(caught)));
  }
  async function continueStudy() {
    if (!question || !feedback || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = answerSession(session, { questionId: question.id, correct: feedback.correct, rating: feedback.rating, hinted: feedback.hinted, now: new Date() });
      const identity = await offlineStore.nextIdentity(props.userId);
      const previous = states[question.cardId];
      const event: ReviewEventInput = { ...result.attempt, ...identity, sessionId: session.id, baseVersion: previous?.version ?? 0, schedulerVersion: SCHEDULER_VERSION, parametersVersion: PARAMETERS_VERSION, answer: feedback.chosen ? question.options.find(option => option.id === feedback.chosen)?.text : undefined, mode: question.mode, hinted: feedback.hinted };
      await offlineStore.commitAttempt(props.userId, result.session, event);
      // The durable attempt is authoritative. A stale feedback draft cannot block
      // advancing or cause the already committed event to be submitted again.
      await offlineStore.deleteDraft(props.userId, `answer:${session.id}`).catch(() => {});
      if (!event.practice) setStates(current => ({ ...current, [question.cardId]: { version: (previous?.version ?? 0) + 1, card: applyRating(previous?.card ?? null, event.rating, new Date(event.occurredAt)) } }));
      setSession(result.session); setFeedback(null); setRevealed(false);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      void props.onSync();
    } catch (caught) { setError(errorMessage(caught)); } finally { submitting.current = false; setBusy(false); }
  }
  if (!question) {
    const answers = session.answers;
    const attempts = Array.isArray(answers) ? answers.length : 0;
    const correct = Array.isArray(answers) ? answers.filter(answer => answer.correct).length : 0;
    return <section className="study-complete"><div className="complete-symbol"><Check size={36} /></div><p className="eyebrow">一点一滴，正在积累</p><h1>这一轮，完成了。</h1><p className="muted">每一次回想，都让这些词更熟悉。</p><div className="result-stats"><div><strong>{attempts}</strong><span>作答次数（含再练）</span></div><div><strong>{attempts ? Math.round(correct / attempts * 100) : 0}%</strong><span>本轮正确率</span></div><div><strong>{session.hardItemIds.length}</strong><span>仍需巩固的词</span></div></div><p className="small muted">本轮纠错不等于长期掌握。正式复习将按记忆计划安排。</p><Button onClick={() => { void offlineStore.clearSession(props.userId); props.onClose(); }}>返回今日<ArrowRight size={18} /></Button></section>;
  }
  const progress = Math.round(session.cursor / Math.max(session.queue.length, 1) * 100);
  return <section className="study-page">
    <div className="study-top"><button className="icon-button" aria-label="暂停学习，保存位置" onClick={props.onClose}><ArrowLeft size={23} /></button><div><span>{question.direction === 'zh-ru' ? '中文选俄语' : question.direction === 'ru-zh' ? '俄语选中文' : '自主回忆'}</span><small>{entry?.practice ? '错词再练 · 不重复增长长期熟练度' : '学习与复习'}</small></div><span className="study-counter">{session.cursor + 1}<span> / {session.queue.length}</span></span></div>
    <div className="progress-track" aria-label="本轮进度" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
    <div className="question-area"><p className="eyebrow">{question.mode === 'recall' ? '试着回想这个词的意思' : '选择与题干相符的一项'}</p><h1 ref={heading} tabIndex={-1} lang={question.direction === 'zh-ru' ? 'zh-CN' : 'ru'} className={question.direction === 'zh-ru' ? '' : 'russian'}>{question.prompt}</h1>
      {question.direction !== 'zh-ru' && <SpeechButton text={item?.russian || question.prompt} onMessage={props.onMessage} />}
      {item && <p className="question-source">{item.book ? `第 ${item.book} 册 · 第 ${item.lessons.join('、')} 课` : '我的词库'}{item.morphology && ` · ${item.morphology}`}</p>}
    </div>
    {question.mode === 'choice' ? <div className="options" aria-label="答案选项">{question.options.map((option, index) => {
      const state = feedback ? option.id === question.correctOptionId ? 'correct' : option.id === feedback.chosen ? 'wrong' : 'dimmed' : '';
      return <button key={option.id} className={`answer-option ${state}`} disabled={!!feedback || busy} onClick={() => void setAnswer(option.id, option.id === question.correctOptionId)}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span lang={question.direction === 'zh-ru' ? 'ru' : 'zh-CN'}>{option.text}</span>{state === 'correct' && <Check size={21} />}{state === 'wrong' && <X size={21} />}</button>;
    })}</div> : <div className="recall-area">{!revealed ? <><p className="small muted">{question.fallbackReason || '先回想，再查看释义。'}</p><Button variant="secondary" onClick={() => setRevealed(true)}><Eye size={19} />查看答案</Button></> : <><div className="recall-answer">{question.answer}</div>{!feedback && <div className="rating-row"><Button variant="secondary" onClick={() => void setAnswer(null, false, 'again')}>忘记了</Button><Button variant="secondary" onClick={() => void setAnswer(null, true, 'hard')}>想起较难</Button><Button onClick={() => void setAnswer(null, true, 'good')}>记住了</Button></div>}</>}</div>}
    {feedback && <div className={`answer-feedback ${feedback.correct ? 'is-correct' : 'is-wrong'}`} role="status"><div className="feedback-heading">{feedback.correct ? <Check size={20} /> : <Sparkles size={20} />}<strong>{feedback.correct ? '答对了' : '再认识它一次'}</strong></div><p className="answer-copy"><span lang="ru">{item?.russian || question.prompt}</span><span>{question.answer}</span></p><p className="small">{question.explanation}</p>{item && <button className="text-link" onClick={() => props.onDetail(item)}>看词条与来源<ArrowRight size={15} /></button>}
      {feedback.correct && <div className="evaluation"><label>这次回想<select value={feedback.rating} onChange={event => reviseFeedback({ rating: event.target.value as RatingName })}><option value="good">记住了</option><option value="hard">想起较难</option><option value="again">其实忘记了</option></select></label><label className="checkbox-label"><input type="checkbox" checked={feedback.hinted} onChange={event => reviseFeedback({ hinted: event.target.checked })} />有提示，或刚才是猜对的</label></div>}
      <p className="small muted">{feedback.correct ? '可在继续前校正评价。' : '这个词会在后面再次出现，最多再练两次。'}</p><Button busy={busy} className="full-width" onClick={() => void continueStudy()}>保存并继续<ArrowRight size={18} /></Button>
    </div>}
    {!feedback && <p className="study-hint">不用着急，先在心里读一遍。</p>}
    {error && <p className="notice notice-error" role="alert">{error} 当前题目仍保留，可重试保存。</p>}
  </section>;
}
