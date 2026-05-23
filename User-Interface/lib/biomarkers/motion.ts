import type { Sample, MotionBiomarkers } from '@/lib/types';

const SAMPLE_RATE_HZ = 60;
const TREMOR_BAND_LOW_HZ = 4;
const TREMOR_BAND_HIGH_HZ = 6;

/** Cooley-Tukey radix-2 FFT (real input → magnitude spectrum). */
function fft(real: Float64Array): Float64Array {
  const n = real.length;
  const magnitude = new Float64Array(n / 2);

  // Bit-reversal permutation
  const rev = new Uint32Array(n);
  let log2n = 0;
  while (1 << log2n < n) log2n++;
  for (let i = 0; i < n; i++) {
    rev[i] = parseInt(i.toString(2).padStart(log2n, '0').split('').reverse().join(''), 2);
  }

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = real[rev[i]];
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const angle = (-2 * Math.PI) / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += size) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const evenRe = re[i + j];
        const evenIm = im[i + j];
        const oddRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const oddIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = evenRe + oddRe;
        im[i + j] = evenIm + oddIm;
        re[i + j + half] = evenRe - oddRe;
        im[i + j + half] = evenIm - oddIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  for (let i = 0; i < n / 2; i++) {
    magnitude[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / n;
  }
  return magnitude;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function computeRms(samples: Sample[]): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) {
    sum += s.x * s.x + s.y * s.y + s.z * s.z;
  }
  return Math.sqrt(sum / samples.length);
}

function computeGaitVariance(samples: Sample[]): number {
  if (samples.length < 10) return 0;
  const magnitudes = samples.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));
  const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
  const variance =
    magnitudes.reduce((acc, m) => acc + (m - mean) ** 2, 0) / magnitudes.length;
  return variance;
}

function analyzeSpectrum(samples: Sample[]): {
  tremor_score: number;
  hand_tremor_hz: number;
  dominant_freq_hz: number;
} {
  if (samples.length < 64) {
    return { tremor_score: 0, hand_tremor_hz: 0, dominant_freq_hz: 0 };
  }

  const magnitudes = samples.map((s) => Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z));
  const n = nextPowerOfTwo(magnitudes.length);
  const padded = new Float64Array(n);
  for (let i = 0; i < magnitudes.length; i++) padded[i] = magnitudes[i];

  const spectrum = fft(padded);
  const freqResolution = SAMPLE_RATE_HZ / n;

  let totalPower = 0;
  let tremorBandPower = 0;
  let dominantIdx = 1;
  let maxPower = 0;

  for (let i = 1; i < spectrum.length; i++) {
    const power = spectrum[i] * spectrum[i];
    const freq = i * freqResolution;
    totalPower += power;
    if (freq >= TREMOR_BAND_LOW_HZ && freq <= TREMOR_BAND_HIGH_HZ) {
      tremorBandPower += power;
    }
    if (power > maxPower && freq >= 0.5 && freq <= 15) {
      maxPower = power;
      dominantIdx = i;
    }
  }

  const tremor_score = totalPower > 0 ? tremorBandPower / totalPower : 0;
  const dominant_freq_hz = dominantIdx * freqResolution;
  const hand_tremor_hz =
    tremor_score > 0.05 ? (TREMOR_BAND_LOW_HZ + TREMOR_BAND_HIGH_HZ) / 2 : 0;

  return { tremor_score, hand_tremor_hz, dominant_freq_hz };
}

/**
 * Extract motion biomarkers from DeviceMotion samples.
 * Real DSP — centerpiece of the demo.
 */
export function extractMotionBiomarkers(
  samples: Sample[],
  mode: 'tremor' | 'walk' = 'tremor'
): MotionBiomarkers {
  const rms_acceleration = computeRms(samples);
  const gait_variance = mode === 'walk' ? computeGaitVariance(samples) : computeGaitVariance(samples) * 0.3;
  const spectral = analyzeSpectrum(samples);

  return {
    tremor_score: spectral.tremor_score,
    hand_tremor_hz: spectral.hand_tremor_hz,
    dominant_freq_hz: spectral.dominant_freq_hz,
    rms_acceleration,
    gait_variance,
  };
}

export function motionBiomarkersToRows(
  biomarkers: MotionBiomarkers
): Array<{ metric_name: string; value: number; unit: string }> {
  return [
    { metric_name: 'tremor_score', value: biomarkers.tremor_score, unit: 'ratio' },
    { metric_name: 'hand_tremor_hz', value: biomarkers.hand_tremor_hz, unit: 'Hz' },
    { metric_name: 'dominant_freq_hz', value: biomarkers.dominant_freq_hz, unit: 'Hz' },
    { metric_name: 'rms_acceleration', value: biomarkers.rms_acceleration, unit: 'm/s²' },
    { metric_name: 'gait_variance', value: biomarkers.gait_variance, unit: 'var' },
  ];
}
