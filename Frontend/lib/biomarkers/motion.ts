import type { Biomarker, Sample } from '@/lib/types';

// Inline Cooley-Tukey radix-2 iterative FFT.
// In-place on real+imag arrays. Length must be power of 2.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n === 0 || (n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be power of 2, got ${n}`);
  }

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const a = i + k;
        const b = a + half;
        const tre = re[b] * cos - im[b] * sin;
        const tim = re[b] * sin + im[b] * cos;
        re[b] = re[a] - tre;
        im[b] = im[a] - tim;
        re[a] += tre;
        im[a] += tim;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Hann window — reduces FFT spectral leakage
function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

interface PowerSpectrum {
  freqs: Float64Array;
  power: Float64Array;
  sampleHz: number;
}

function powerSpectrum(signal: number[], sampleHz: number): PowerSpectrum {
  const n0 = signal.length;
  if (n0 < 8) {
    return { freqs: new Float64Array(0), power: new Float64Array(0), sampleHz };
  }
  const n = nextPow2(n0);

  // mean-center + window + zero-pad
  let mean = 0;
  for (let i = 0; i < n0; i++) mean += signal[i];
  mean /= n0;

  const window = hannWindow(n0);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n0; i++) re[i] = (signal[i] - mean) * window[i];

  fft(re, im);

  const half = n >> 1;
  const power = new Float64Array(half);
  const freqs = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    power[i] = re[i] * re[i] + im[i] * im[i];
    freqs[i] = (i * sampleHz) / n;
  }
  return { freqs, power, sampleHz };
}

// Effective sample rate (Hz) from sample timestamps (ms).
function estimateSampleHz(samples: Sample[]): number {
  if (samples.length < 2) return 60;
  const span = (samples[samples.length - 1].t - samples[0].t) / 1000;
  if (span <= 0) return 60;
  return (samples.length - 1) / span;
}

// Linear magnitude per sample: sqrt(x^2 + y^2 + z^2) minus gravity (~9.81).
function linearMagnitude(samples: Sample[]): number[] {
  const mag: number[] = [];
  for (const s of samples) {
    const m = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
    mag.push(m - 9.81);
  }
  return mag;
}

function rmsAcceleration(linear: number[]): number {
  if (linear.length === 0) return 0;
  let sum = 0;
  for (const v of linear) sum += v * v;
  return Math.sqrt(sum / linear.length);
}

// Power in [lo, hi] Hz band divided by total power.
function bandPowerRatio(spec: PowerSpectrum, lo: number, hi: number): number {
  let band = 0;
  let total = 0;
  for (let i = 0; i < spec.freqs.length; i++) {
    const f = spec.freqs[i];
    const p = spec.power[i];
    total += p;
    if (f >= lo && f <= hi) band += p;
  }
  return total > 0 ? band / total : 0;
}

function dominantFreq(spec: PowerSpectrum, lo: number, hi: number): number {
  let bestF = 0;
  let bestP = -Infinity;
  for (let i = 0; i < spec.freqs.length; i++) {
    const f = spec.freqs[i];
    if (f < lo || f > hi) continue;
    if (spec.power[i] > bestP) {
      bestP = spec.power[i];
      bestF = f;
    }
  }
  return bestF;
}

// Stride-to-stride variance: detect peaks (zero-crossings on derivative w/ min spacing).
function gaitVariance(linear: number[], sampleHz: number): number {
  if (linear.length < sampleHz) return 0;
  // smooth w/ moving avg ~0.1s window
  const win = Math.max(1, Math.round(sampleHz * 0.1));
  const smooth: number[] = [];
  for (let i = 0; i < linear.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -win; k <= win; k++) {
      const j = i + k;
      if (j >= 0 && j < linear.length) {
        s += linear[j];
        c++;
      }
    }
    smooth.push(s / c);
  }

  // Peak detect: local max above threshold w/ min spacing 0.3s
  const minSpacing = Math.round(sampleHz * 0.3);
  let threshold = 0;
  for (const v of smooth) threshold += Math.abs(v);
  threshold = (threshold / smooth.length) * 0.5;

  const peaks: number[] = [];
  for (let i = 1; i < smooth.length - 1; i++) {
    if (
      smooth[i] > threshold &&
      smooth[i] > smooth[i - 1] &&
      smooth[i] >= smooth[i + 1] &&
      (peaks.length === 0 || i - peaks[peaks.length - 1] >= minSpacing)
    ) {
      peaks.push(i);
    }
  }

  if (peaks.length < 3) return 0;

  const intervals: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    intervals.push((peaks[i] - peaks[i - 1]) / sampleHz);
  }
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  let varSum = 0;
  for (const v of intervals) varSum += (v - mean) ** 2;
  return Math.sqrt(varSum / intervals.length); // stddev in seconds
}

export type MotionMode = 'walk_test' | 'hand_tremor' | 'lap_rest';

export function extractMotionBiomarkers(
  samples: Sample[],
  mode: MotionMode,
): Biomarker[] {
  if (samples.length < 16) return [];

  const sampleHz = estimateSampleHz(samples);
  const linear = linearMagnitude(samples);
  const spec = powerSpectrum(linear, sampleHz);
  const prefix = mode; // 'lap_rest' | 'hand_tremor' | 'walk_test'

  const out: Biomarker[] = [];

  out.push({
    category: 'motion',
    metric_name: `${prefix}.rms_acceleration`,
    value: rmsAcceleration(linear),
    unit: 'm/s^2',
  });

  out.push({
    category: 'motion',
    metric_name: `${prefix}.sample_hz`,
    value: Math.round(sampleHz * 10) / 10,
    unit: 'hz',
  });

  // Parkinsonian tremor band 4-6 Hz
  const tremorScore = bandPowerRatio(spec, 4, 6);
  out.push({
    category: 'motion',
    metric_name: `${prefix}.tremor_score`,
    value: tremorScore,
    unit: 'ratio',
  });

  const handTremorHz = dominantFreq(spec, 3, 8);
  out.push({
    category: 'motion',
    metric_name: `${prefix}.hand_tremor_hz`,
    value: handTremorHz,
    unit: 'hz',
  });

  const dominant = dominantFreq(spec, 0.5, Math.min(sampleHz / 2 - 1, 20));
  out.push({
    category: 'motion',
    metric_name: `${prefix}.dominant_freq_hz`,
    value: dominant,
    unit: 'hz',
  });

  if (mode === 'walk_test') {
    out.push({
      category: 'motion',
      metric_name: `${prefix}.gait_variance`,
      value: gaitVariance(linear, sampleHz),
      unit: 's',
    });
  }

  return out;
}

// Mock generator for laptop dev (no phone needed).
// Produces a believable tremor-like signal at given Hz w/ noise.
export function generateMockSamples(opts: {
  durationSec: number;
  sampleHz?: number;
  tremorHz?: number;
  tremorAmp?: number;
  noiseAmp?: number;
}): Sample[] {
  const sampleHz = opts.sampleHz ?? 60;
  const tremorHz = opts.tremorHz ?? 5;
  const tremorAmp = opts.tremorAmp ?? 1.5;
  const noiseAmp = opts.noiseAmp ?? 0.3;
  const n = Math.floor(opts.durationSec * sampleHz);
  const dt = 1000 / sampleHz;
  const t0 = Date.now();

  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const t = t0 + i * dt;
    const phase = (2 * Math.PI * tremorHz * i) / sampleHz;
    const sx = tremorAmp * Math.sin(phase) + (Math.random() - 0.5) * noiseAmp;
    const sy = tremorAmp * 0.6 * Math.cos(phase) + (Math.random() - 0.5) * noiseAmp;
    const sz = 9.81 + (Math.random() - 0.5) * noiseAmp;
    samples.push({
      t,
      x: Math.round(sx * 1000) / 1000,
      y: Math.round(sy * 1000) / 1000,
      z: Math.round(sz * 1000) / 1000,
    });
  }
  return samples;
}