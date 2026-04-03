#!/usr/bin/env python3
"""
Extract video and audio clips from a YouTube video for specific phrases.

Usage:
  python3 extract_clips.py <video_id> <output_dir> <phrases_json>

Where phrases_json is a JSON string: [{"id": "...", "startTime": 0.0, "duration": 5.0}, ...]

Output: JSON to stdout with file paths for each extracted clip.
"""

import sys
import os
import json
import subprocess
import tempfile


def download_video(video_id: str, output_path: str) -> str:
    """Download YouTube video at 480p max using yt-dlp."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    cmd = [
        "yt-dlp",
        "-f", "bestvideo[height<=480]+bestaudio/best[height<=480]",
        "--merge-output-format", "mp4",
        "-o", output_path,
        "--no-playlist",
        "--no-warnings",
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr}")
    return output_path


def extract_clip(input_path: str, output_path: str, start: float, duration: float):
    """Extract a video clip segment with frame-accurate cutting.

    Uses -ss before -i for fast seeking to the nearest keyframe,
    then re-encodes for precise start/end points. For 5-15s clips
    at 480p this takes ~2-3 seconds per clip.
    """
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", input_path,
        "-t", str(duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",  # optimize for streaming
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg clip extraction failed: {result.stderr}")


def extract_audio(input_path: str, output_path: str, start: float, duration: float):
    """Extract audio-only WAV (16kHz mono) for prosody analysis."""
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-t", str(duration),
        "-i", input_path,
        "-vn",              # no video
        "-ar", "16000",     # 16kHz
        "-ac", "1",         # mono
        "-f", "wav",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg audio extraction failed: {result.stderr}")


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: extract_clips.py <video_id> <output_dir> <phrases_json>"}))
        sys.exit(1)

    video_id = sys.argv[1]
    output_dir = sys.argv[2]
    phrases = json.loads(sys.argv[3])

    os.makedirs(output_dir, exist_ok=True)

    # Step 1: Download full video
    video_path = os.path.join(output_dir, f"{video_id}.mp4")
    if not os.path.exists(video_path):
        sys.stderr.write(f"Downloading video {video_id}...\n")
        download_video(video_id, video_path)

    # Step 2: Extract clips for each phrase
    results = []
    for i, phrase in enumerate(phrases):
        phrase_id = phrase["id"]
        start = float(phrase["startTime"])
        duration = float(phrase["duration"])

        # Small padding after for natural boundary (speaker may trail off)
        padded_start = start
        padded_duration = duration + 0.15

        clip_path = os.path.join(output_dir, f"{phrase_id.replace(':', '_').replace('-', '_')}_clip.mp4")
        audio_path = os.path.join(output_dir, f"{phrase_id.replace(':', '_').replace('-', '_')}_audio.wav")

        sys.stderr.write(f"Extracting clip {i+1}/{len(phrases)}: {phrase_id}\n")

        extract_clip(video_path, clip_path, padded_start, padded_duration)
        extract_audio(video_path, audio_path, padded_start, padded_duration)

        results.append({
            "phraseId": phrase_id,
            "clipPath": clip_path,
            "audioPath": audio_path,
        })

    # Clean up full video to save disk space
    try:
        os.remove(video_path)
    except OSError:
        pass

    print(json.dumps(results))


if __name__ == "__main__":
    main()
