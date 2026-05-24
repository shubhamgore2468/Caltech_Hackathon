import pandas as pd
import numpy as np
from scipy import signal


def get_session_confidence_intervals(patient_data):
    """
    Accepts IMU records (list of dicts with keys t,x,y,z), calculates sliding-window PSD,
    returns mean and 95% CI for PD and ET ratios.
    """
    df = pd.DataFrame(patient_data)
    window = 2
    epsilon = 3e-2

    df['t_sec'] = df['t'] / 1000.0
    mean_dt = df['t_sec'].diff().dropna().mean()
    fs = 1.0 / mean_dt

    df['mag'] = np.sqrt(df['x'] ** 2 + df['y'] ** 2 + df['z'] ** 2)
    df['mag_centered'] = df['mag'] - df['mag'].mean()

    nperseg = int(np.round(fs * window))
    noverlap = int(nperseg * 0.90)

    if len(df) < nperseg:
        raise ValueError("Data is too short to calculate a 1-second window.")

    f, t_spec, Sxx = signal.spectrogram(
        df['mag_centered'],
        fs=fs,
        window='hann',
        nperseg=nperseg,
        noverlap=noverlap,
        scaling='density',
    )

    total_idx = np.where((f >= 1.0) & (f <= 15.0))[0]
    pd_idx = np.where((f >= 3.0) & (f <= 6.0))[0]
    et_idx = np.where((f >= 4.0) & (f <= 12.0))[0]

    pd_ratios = []
    et_ratios = []

    for i in range(len(t_spec)):
        power_spectrum = Sxx[:, i]

        total_power = np.trapezoid(power_spectrum[total_idx], f[total_idx])
        pd_power = np.trapezoid(power_spectrum[pd_idx], f[pd_idx])
        et_power = np.trapezoid(power_spectrum[et_idx], f[et_idx])
        pd_ratios.append(pd_power / (total_power + epsilon))
        et_ratios.append(et_power / (total_power + 2 * epsilon))

    n = len(pd_ratios)
    if n == 0:
        raise ValueError("No valid frequency windows found.")

    pd_mean = np.mean(pd_ratios)
    et_mean = np.mean(et_ratios)

    pd_std = np.std(pd_ratios, ddof=1) if n > 1 else 0
    et_std = np.std(et_ratios, ddof=1) if n > 1 else 0

    z_score = 1.96
    pd_margin = z_score * (pd_std / np.sqrt(n))
    et_margin = z_score * (et_std / np.sqrt(n))

    return {
        "duration_seconds": round(df['t_sec'].iloc[-1] - df['t_sec'].iloc[0], 2),
        "windows_analyzed": n,
        "metrics_pd_ratio": {
            "mean": round(float(pd_mean), 4),
            "ci_lower": round(float(pd_mean - pd_margin), 4),
            "ci_upper": round(float(pd_mean + pd_margin), 4),
        },
        "metrics_et_ratio": {
            "mean": round(float(et_mean), 4),
            "ci_lower": round(float(et_mean - et_margin), 4),
            "ci_upper": round(float(et_mean + et_margin), 4),
        },
    }
