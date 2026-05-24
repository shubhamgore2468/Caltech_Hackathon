// Mic capture → PCM16 mono 16kHz WAV blob.
// Push-to-talk lifecycle: start() → stop() returns Blob.

const TARGET_SAMPLE_RATE = 16_000;

export interface RecorderHandle {
  stop: () => Promise<Blob>;
  cancel: () => void;
}

export async function startRecording(): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const AudioCtor: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtor();
  const source = ctx.createMediaStreamSource(stream);

  // ScriptProcessor is deprecated but universally supported; AudioWorklet would need a separate module file.
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
  const chunks: Float32Array[] = [];

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  let stopped = false;

  function teardown() {
    if (stopped) return;
    stopped = true;
    processor.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }

  return {
    stop: async () => {
      if (stopped) throw new Error('already stopped');
      const inputRate = ctx.sampleRate;
      teardown();
      const merged = mergeFloat32(chunks);
      const downsampled = downsampleTo(merged, inputRate, TARGET_SAMPLE_RATE);
      const wav = encodeWav(downsampled, TARGET_SAMPLE_RATE);
      return new Blob([wav], { type: 'audio/wav' });
    },
    cancel: () => teardown(),
  };
}

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Float32Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function downsampleTo(buffer: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate === inRate) return buffer;
  if (outRate > inRate) throw new Error('upsampling not supported');
  const ratio = inRate / outRate;
  const newLen = Math.floor(buffer.length / ratio);
  const out = new Float32Array(newLen);
  let oi = 0;
  let ii = 0;
  while (oi < newLen) {
    const next = Math.floor((oi + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let i = ii; i < next && i < buffer.length; i++) {
      sum += buffer[i];
      count++;
    }
    out[oi] = count > 0 ? sum / count : 0;
    oi++;
    ii = next;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  writeStr(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, 'WAVE');
  writeStr(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}
