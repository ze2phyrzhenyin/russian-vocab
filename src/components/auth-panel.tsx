'use client';

import { useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, Layers3, Repeat2 } from 'lucide-react';
import { authClient } from '../lib/api-client';
import { Button } from './ui';

export default function AuthPanel({ demoMode, onSuccess }: { demoMode: boolean; onSuccess: () => Promise<void> }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function login(demo = false) {
    setBusy(true); setError('');
    try {
      const result = signup && !demo ? await authClient.signUp.email({ email, password, name }) : await authClient.signIn.email({ email: demo ? 'demo@ruslearn.test' : email, password: demo ? 'RusDemo!2026' : password });
      if (result.error) {
        const messages:Record<string,string>={INVALID_EMAIL_OR_PASSWORD:'邮箱或密码不正确，请重试。',INVALID_EMAIL:'请填写有效的邮箱地址。',USER_ALREADY_EXISTS:'这个邮箱已注册，请返回登录。',USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:'这个邮箱已注册，请返回登录。',PASSWORD_TOO_SHORT:'密码至少需要 10 位。',PASSWORD_TOO_LONG:'密码过长，请缩短后重试。'};
        throw new Error(result.error.status===429?'操作太频繁，请稍等片刻再试。':messages[result.error.code??'']||'暂时无法完成，请检查填写内容后重试。');
      }
      await onSuccess();
    } catch (caught) { setError(caught instanceof Error&&/[\u3400-\u9FFF]/.test(caught.message)?caught.message:'暂时无法连接，请检查网络后重试。'); } finally { setBusy(false); }
  }
  return <main className="auth-layout">
    <section className="auth-story"><div className="brand"><span className="brand-mark">с</span><div><strong>俄语拾词</strong><span>SLOVO</span></div></div>
      <p className="eyebrow">让每一个词，慢慢熟悉。</p><h1>从一个词开始，<br />走近另一种生活。</h1>
      <div className="auth-word"><small>СЛОВО ДНЯ</small><span lang="ru">здравствуй</span><p>你好 · 每一次相遇，都是新的开始。</p></div>
      <div className="auth-features"><span><BookOpen size={19} />跟着教材选课</span><span><Repeat2 size={19} />按记忆安排复习</span><span><Layers3 size={19} />积累自己的词库</span></div>
      <p className="auth-footnote">《东方俄语》第 1–6 册工作簿 · 保留词条与原页来源</p>
    </section>
    <section className="auth-form-wrap"><div className="auth-form"><p className="eyebrow">ДОБРО ПОЖАЛОВАТЬ</p><h2>{signup ? '开启你的俄语积累' : '欢迎回来'}</h2><p className="muted">{signup ? '创建账号，保存选课、词库和每一次练习。' : '继续上次的进度，今天也记住一点。'}</p>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void login(); }}>
        {signup && <label>怎么称呼你<input required value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={60} /></label>}
        <label>邮箱<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></label>
        <label>密码<input type="password" required minLength={10} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 10 位" /></label>
        {error && <p role="alert" className="notice notice-error">{error}</p>}
        <Button type="submit" busy={busy} className="full-width">{signup ? '创建账号' : '登录'}<ArrowRight size={18} /></Button>
      </form>
      <button className="auth-switch text-link" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? '已有账号？返回登录' : '第一次来？创建账号'}</button>
      {demoMode && <div className="demo-signin"><span>独立演示环境</span><Button variant="secondary" busy={busy} onClick={() => void login(true)}>一键体验</Button><small>使用演示账号登录，查看带示例进度的学习流程。</small></div>}
    </div></section>
  </main>;
}
