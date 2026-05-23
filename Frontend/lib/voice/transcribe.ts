'use client';

// Web Speech API wrappers w/ unsupported-browser fallback.
// STT: SpeechRecognition (Chrome, Safari iOS 14.5+).
// TTS: SpeechSynthesis (universal).

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function getRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSTTSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export interface STTCallbacks {
  onInterim?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (msg: string) => void;
  onEnd?: () => void;
}

export interface STTHandle {
  stop: () => void;
}

export function startSTT(cb: STTCallbacks): STTHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    cb.onError?.('Speech recognition not supported on this browser');
    return null;
  }
  const r = new Ctor();
  r.lang = 'en-US';
  r.continuous = false;
  r.interimResults = true;

  r.onresult = (e) => {
    let interim = '';
    let final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      const text = res[0].transcript;
      if (res.isFinal) final += text;
      else interim += text;
    }
    if (interim) cb.onInterim?.(interim);
    if (final) cb.onFinal(final.trim());
  };
  r.onerror = (e) => cb.onError?.(e.error);
  r.onend = () => cb.onEnd?.();

  try {
    r.start();
  } catch (e) {
    cb.onError?.(e instanceof Error ? e.message : String(e));
    return null;
  }

  return { stop: () => r.stop() };
}

// TTS — browser SpeechSynthesis.
export function speak(text: string, opts: { rate?: number; pitch?: number } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function cancelSpeak() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}
