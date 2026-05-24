'use client';

import { useEffect, useRef, useState } from 'react';
import { startRecording, type RecorderHandle } from '@/lib/voice/recorder';
import { DEMO_PATIENT_ID, type ConversationTurn } from '@/lib/types';

type UIState = 'idle' | 'recording' | 'thinking' | 'speaking';

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\?{2,}/g, '')
    .replace(/\s+\?\s+/g, ' ')
    .trim();
}

export default function CheckinPage() {
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [state, setState] = useState<UIState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `sess-${Date.now()}`,
  );

  const recRef = useRef<RecorderHandle | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, state]);

  async function sendAudio(wav: Blob) {
    setState('thinking');
    setError(null);
    try {
      const form = new FormData();
      form.append('audio', wav, 'turn.wav');
      form.append('session_id', sessionId);
      form.append('patient_id', DEMO_PATIENT_ID);

      const res = await fetch('/api/voice/turn', { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`turn failed: ${text.slice(0, 300)}`);
      }

      const userText = stripMarkdown(res.headers.get('X-User-Transcript') ?? '');
      const assistantText = stripMarkdown(res.headers.get('X-Assistant-Transcript') ?? '');
      const audioBuf = await res.arrayBuffer();

      setMessages((cur) => [
        ...cur,
        { role: 'user', content: userText || '(no speech detected)', timestamp: Date.now() },
        { role: 'assistant', content: assistantText, timestamp: Date.now() },
      ]);

      setState('speaking');
      await playAudio(audioBuf, res.headers.get('Content-Type') ?? 'audio/wav');
      setState('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  }

  function playAudio(buf: ArrayBuffer, mime: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const blob = new Blob([buf], { type: mime });
      const url = URL.createObjectURL(blob);
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      el.src = url;
      el.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('audio playback failed'));
      };
      void el.play().catch(reject);
    });
  }

  async function startHold() {
    if (state !== 'idle') return;
    setError(null);
    try {
      const handle = await startRecording();
      recRef.current = handle;
      setState('recording');
    } catch (e) {
      setError(`mic: ${e instanceof Error ? e.message : String(e)}`);
      setState('idle');
    }
  }

  async function endHold() {
    if (state !== 'recording' || !recRef.current) return;
    const handle = recRef.current;
    recRef.current = null;
    try {
      const wav = await handle.stop();
      await sendAudio(wav);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  }

  function cancelHold() {
    recRef.current?.cancel();
    recRef.current = null;
    setState('idle');
  }

  async function resetSession() {
    setMessages([]);
    setError(null);
    setState('idle');
    try {
      const form = new FormData();
      form.append('session_id', sessionId);
      await fetch('/api/voice/reset', { method: 'POST', body: form });
    } catch {
      // best-effort
    }
  }

  const busy = state === 'thinking' || state === 'speaking';
  const statusLabel = {
    idle: 'Ready',
    recording: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }[state];

  return (
    <main className="min-h-screen flex flex-col bg-stone-50 text-stone-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-stone-50/90 backdrop-blur border-b border-stone-200 px-4 py-3 flex items-center justify-between max-w-md mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${
            state === 'recording' ? 'bg-rose-500 animate-pulse' :
            state === 'thinking' ? 'bg-amber-500 animate-pulse' :
            state === 'speaking' ? 'bg-emerald-500 animate-pulse' :
            'bg-stone-400'
          }`} />
          <h1 className="text-base font-medium">Daily Check-in</h1>
        </div>
        <button
          onClick={resetSession}
          className="text-xs text-stone-500 hover:text-stone-800 underline-offset-4 hover:underline"
        >
          Reset
        </button>
      </header>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto max-w-md mx-auto w-full px-4 py-4 flex flex-col gap-3"
        style={{ minHeight: 0 }}
      >
        {messages.length === 0 && state === 'idle' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-12">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <MicIcon className="h-7 w-7 text-emerald-700" />
            </div>
            <h2 className="text-lg font-medium">Let's check in</h2>
            <p className="text-sm text-stone-500 max-w-xs">
              Hold the green button below and tell me how you're feeling. Release when you're done.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'assistant' ? 'justify-start' : 'justify-end'}`}
          >
            {m.role === 'assistant' && (
              <div className="h-8 w-8 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center mr-2 mt-0.5 shrink-0 font-medium">
                AI
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap shadow-sm ${
                m.role === 'assistant'
                  ? 'bg-white border border-stone-200 rounded-tl-sm'
                  : 'bg-emerald-600 text-white rounded-tr-sm'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {state === 'thinking' && (
          <div className="flex justify-start">
            <div className="h-8 w-8 rounded-full bg-emerald-600 text-white text-xs flex items-center justify-center mr-2 mt-0.5 font-medium">
              AI
            </div>
            <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <ThinkingDots />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="max-w-md mx-auto w-full px-4">
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {error}
          </div>
        </div>
      )}

      {/* Mic button */}
      <div className="sticky bottom-0 bg-gradient-to-t from-stone-50 via-stone-50 to-transparent pt-8 pb-6 px-4 max-w-md mx-auto w-full">
        <div className="flex flex-col items-center gap-2">
          <button
            disabled={busy}
            onMouseDown={startHold}
            onMouseUp={endHold}
            onMouseLeave={() => state === 'recording' && cancelHold()}
            onTouchStart={(e) => {
              e.preventDefault();
              startHold();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              endHold();
            }}
            className={`relative h-20 w-20 rounded-full flex items-center justify-center shadow-lg transition-all select-none touch-none ${
              state === 'recording'
                ? 'bg-rose-500 scale-110'
                : busy
                  ? 'bg-stone-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
            }`}
          >
            {state === 'recording' && (
              <span className="absolute inset-0 rounded-full bg-rose-500 animate-ping opacity-60" />
            )}
            <MicIcon className="h-8 w-8 text-white relative" />
          </button>
          <span className="text-xs text-stone-500 mt-1">
            {state === 'idle' ? 'Hold to talk' : statusLabel}
          </span>
        </div>
      </div>
    </main>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function ThinkingDots() {
  return (
    <div className="flex gap-1 items-center h-5">
      <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="h-2 w-2 rounded-full bg-stone-400 animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}
