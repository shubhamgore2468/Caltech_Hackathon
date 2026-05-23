'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/Frontend/components/ui/button';
import { Card, CardContent } from '@/Frontend/components/ui/card';
import { Badge } from '@/Frontend/components/ui/badge';
import { isSTTSupported, startSTT, speak, cancelSpeak, type STTHandle } from '@/lib/voice/transcribe';
import type { ConversationTurn } from '@/lib/types';

type UIState = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function CheckinPage() {
  const [messages, setMessages] = useState<ConversationTurn[]>([]);
  const [state, setState] = useState<UIState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sttAvailable, setSttAvailable] = useState(false);
  const [textInput, setTextInput] = useState('');
  const sttRef = useRef<STTHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSttAvailable(isSTTSupported());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, interim]);

  async function sendToAssistant(userText: string) {
    setError(null);
    const next: ConversationTurn[] = [
      ...messages,
      { role: 'user', content: userText, timestamp: Date.now() },
    ];
    setMessages(next);
    setState('thinking');

    try {
      const res = await fetch('/api/conversation/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.text();
        throw new Error(`turn failed: ${errBody}`);
      }

      // Stream tokens into a growing assistant message
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      setMessages([
        ...next,
        { role: 'assistant', content: '', timestamp: Date.now() },
      ]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setMessages((cur) => {
          const copy = cur.slice();
          copy[copy.length - 1] = { ...copy[copy.length - 1], content: assistantText };
          return copy;
        });
      }

      // Speak full response
      setState('speaking');
      await speak(assistantText);
      setState('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState('idle');
    }
  }

  function startListening() {
    if (state !== 'idle') return;
    cancelSpeak();
    setInterim('');
    setState('listening');
    const handle = startSTT({
      onInterim: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim('');
        sttRef.current?.stop();
        sttRef.current = null;
        if (t.trim()) sendToAssistant(t.trim());
        else setState('idle');
      },
      onError: (msg) => {
        setError(`mic: ${msg}`);
        setState('idle');
      },
      onEnd: () => {
        if (state === 'listening') setState('idle');
      },
    });
    sttRef.current = handle;
    if (!handle) setState('idle');
  }

  function stopListening() {
    sttRef.current?.stop();
    sttRef.current = null;
    setState('idle');
  }

  function sendText() {
    if (!textInput.trim()) return;
    const v = textInput.trim();
    setTextInput('');
    sendToAssistant(v);
  }

  // Auto-greet on mount
  useEffect(() => {
    if (messages.length === 0) {
      sendToAssistant('Hi.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen flex flex-col max-w-md mx-auto p-4 gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Daily Check-in</h1>
        <Badge variant={state === 'idle' ? 'secondary' : 'default'}>
          {state}
        </Badge>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto flex flex-col gap-2 py-2"
        style={{ minHeight: 0 }}
      >
        {messages.map((m, i) => (
          <Card
            key={i}
            className={
              m.role === 'assistant'
                ? 'self-start max-w-[85%] bg-zinc-900 border-zinc-800'
                : 'self-end max-w-[85%] bg-emerald-900/40 border-emerald-800'
            }
          >
            <CardContent className="py-2 px-3 text-sm whitespace-pre-wrap">
              {m.content || (m.role === 'assistant' && state === 'thinking' ? '…' : '')}
            </CardContent>
          </Card>
        ))}
        {interim && (
          <Card className="self-end max-w-[85%] bg-zinc-800/60 border-zinc-700 opacity-70">
            <CardContent className="py-2 px-3 text-sm italic">{interim}</CardContent>
          </Card>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-400 px-2">{error}</div>
      )}

      <div className="flex flex-col gap-2">
        {sttAvailable ? (
          <Button
            size="lg"
            className="w-full py-6 text-lg"
            onClick={state === 'listening' ? stopListening : startListening}
            variant={state === 'listening' ? 'destructive' : 'default'}
            disabled={state === 'thinking' || state === 'speaking'}
          >
            {state === 'listening' ? 'Stop' : state === 'thinking' ? 'Thinking…' : state === 'speaking' ? 'Speaking…' : 'Hold to talk'}
          </Button>
        ) : (
          <div className="text-xs text-amber-400">Voice not supported here — use text below.</div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendText();
          }}
          className="flex gap-2"
        >
          <input
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Or type a reply…"
            className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 px-3 py-2 text-sm"
            disabled={state === 'thinking' || state === 'speaking'}
          />
          <Button type="submit" variant="outline" disabled={!textInput.trim() || state === 'thinking' || state === 'speaking'}>
            Send
          </Button>
        </form>
      </div>
    </main>
  );
}
