#!/usr/bin/env python3
"""
Analyze prosody (pitch, energy, rhythm) from a WAV audio file.

Usage:
  python3 analyze_prosody.py <audio_path> <phrase_id>

Output: JSON to stdout with prosody profile.

Uses parselmouth (Praat wrapper) for gold-standard F0 pitch extraction
and numpy for energy analysis. Onset detection uses a simple energy-based
approach to avoid the heavy librosa dependency.
"""

import sys
import json
import math
import numpy as np

try:
    import parselmouth
    from parselmouth.praat import call
except ImportError:
    print(json.dumps({"error": "parselmouth not installed"}))
    sys.exit(1)


def extract_prosody(audio_path: str, phrase_id: str) -> dict:
    """Extract prosody profile from a WAV file."""

    # Load audio with parselmouth
    sound = parselmouth.Sound(audio_path)
    duration = sound.get_total_duration()
    sample_rate = int(sound.sampling_frequency)

    # ── Pitch extraction (F0) ──
    # time_step=0.01 → one value per 10ms
    pitch = sound.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    pitch_values = pitch.selected_array["frequency"]

    # Convert Hz to semitones relative to median (speaker-independent)
    voiced_values = [f for f in pitch_values if f > 0]
    if voiced_values:
        median_hz = float(np.median(voiced_values))
    else:
        median_hz = 150.0  # fallback

    pitch_semitones = []
    for f in pitch_values:
        if f > 0:
            semitones = 12.0 * math.log2(f / median_hz)
            pitch_semitones.append(round(semitones, 2))
        else:
            pitch_semitones.append(None)  # unvoiced frame

    # ── Energy / Intensity ──
    # Compute RMS energy in windows matching pitch time step (10ms)
    samples = sound.values[0]  # mono
    hop_samples = int(sample_rate * 0.01)  # 10ms hop
    window_samples = int(sample_rate * 0.025)  # 25ms window

    energy = []
    for i in range(0, len(samples) - window_samples, hop_samples):
        frame = samples[i:i + window_samples]
        rms = float(np.sqrt(np.mean(frame ** 2)))
        energy.append(rms)

    # Trim or pad energy to match pitch length
    target_len = len(pitch_semitones)
    if len(energy) > target_len:
        energy = energy[:target_len]
    while len(energy) < target_len:
        energy.append(0.0)

    # Normalize energy to 0-1
    max_energy = max(energy) if energy else 1.0
    if max_energy > 0:
        energy = [round(e / max_energy, 4) for e in energy]

    # ── Onset detection (energy-based) ──
    # Simple approach: find frames where energy rises sharply
    onsets = []
    if len(energy) > 2:
        # Smooth energy with a small window
        smoothed = np.convolve(energy, np.ones(3) / 3, mode="same")
        threshold = 0.15 * max(smoothed)  # 15% of peak
        min_gap = 8  # minimum 80ms between onsets (at 10ms hop)
        last_onset = -min_gap

        for i in range(1, len(smoothed)):
            # Rising edge above threshold
            if smoothed[i] > threshold and smoothed[i] > smoothed[i - 1] * 1.3:
                if i - last_onset >= min_gap:
                    onsets.append(round(i * 0.01, 3))  # convert frame to seconds
                    last_onset = i

    # ── Speaking rate (syllables per second approximation) ──
    speaking_rate = round(len(onsets) / duration, 2) if duration > 0 else 0.0

    return {
        "phraseId": phrase_id,
        "sampleRate": 100,  # 100 points per second (10ms hop)
        "pitchSemitones": pitch_semitones,
        "energy": energy,
        "onsets": onsets,
        "durationSec": round(duration, 3),
        "medianPitchHz": round(median_hz, 1),
        "speakingRate": speaking_rate,
    }


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: analyze_prosody.py <audio_path> <phrase_id>"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    phrase_id = sys.argv[2]

    result = extract_prosody(audio_path, phrase_id)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
