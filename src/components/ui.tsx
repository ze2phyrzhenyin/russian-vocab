'use client';

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X, LoaderCircle, ArrowRight, Volume2 } from 'lucide-react';

export function Button({ children, className = '', variant = 'primary', busy = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy}>{busy && <LoaderCircle size={18} className="spin" aria-hidden="true" />}{children}</button>;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current; const before = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); before?.focus?.(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="modal-surface"><header className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={22} /></button></header><div className="modal-body">{children}</div></div>
  </dialog>;
}
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark" aria-hidden="true">слово</span><h3>{title}</h3>{children && <p>{children}</p>}{action}</div>;
}
export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{action}</header>;
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-link" onClick={onClick}>{children}<ArrowRight size={17} /></button>;
}
export function SpeechButton({ text, onMessage }: { text: string; onMessage: (message: string) => void }) {
  useEffect(() => { if ('speechSynthesis' in window) speechSynthesis.getVoices(); }, []);
  function speak() {
    if (!('speechSynthesis' in window)) { onMessage('当前浏览器不支持朗读。'); return; }
    const voice = speechSynthesis.getVoices().find(candidate => candidate.lang.toLowerCase().startsWith('ru'));
    if (!voice) { onMessage('当前未检测到俄语语音。请稍后重试，或在系统语音设置中添加俄语。'); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.normalize('NFC').replace(/[\u0300\u0301]/g, ''));
    utterance.lang = 'ru-RU'; utterance.voice = voice; utterance.rate = 0.85;
    utterance.onerror = () => onMessage('俄语朗读暂不可用，请检查系统语音或网络。');
    speechSynthesis.speak(utterance);
  }
  return <button className="icon-button speech-button" aria-label="朗读俄语" onClick={speak}><Volume2 size={22} /></button>;
}
