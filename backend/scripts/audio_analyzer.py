#!/usr/bin/env python3
import sys
import subprocess
import numpy as np
import json
import math
import os

FFMPEG = os.environ.get("FFMPEG_BINARY", "ffmpeg")

def get_audio_energy(audio_path, window_ms=100):
    # Decode audio to raw 32-bit float PCM at 16000 Hz, 1 channel
    command = [
        FFMPEG,
        '-i', audio_path,
        '-f', 'f32le',
        '-ac', '1',
        '-ar', '16000',
        '-loglevel', 'quiet',
        '-'
    ]
    
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        raw_audio, _ = process.communicate()
    except Exception as e:
        print(json.dumps({"error": f"Failed to extract audio with ffmpeg: {str(e)}"}), file=sys.stderr)
        sys.exit(1)
        
    if not raw_audio:
        print(json.dumps({"error": "No audio data extracted"}), file=sys.stderr)
        sys.exit(1)

    # Convert bytes to numpy array
    audio_data = np.frombuffer(raw_audio, dtype=np.float32)
    
    sample_rate = 16000
    window_size = int((window_ms / 1000.0) * sample_rate)
    
    energies = []
    
    # Calculate RMS energy for each window
    for i in range(0, len(audio_data), window_size):
        window = audio_data[i:i+window_size]
        if len(window) == 0:
            break
        # RMS = root mean square
        rms = np.sqrt(np.mean(window**2))
        # Convert to dB, adding small epsilon to avoid log(0)
        db = 20 * math.log10(rms + 1e-9)
        # We can map -60dB (quiet) to 0, and 0dB (loudest) to 1.0
        normalized_energy = max(0.0, (db + 60) / 60.0)
        energies.append(round(normalized_energy, 3))
        
    return energies

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python audio_analyzer.py <audio_path>", file=sys.stderr)
        sys.exit(1)
        
    audio_path = sys.argv[1]
    
    energies = get_audio_energy(audio_path)
    
    # Calculate a dynamic threshold for "LOUD" moments
    # Top 15% loudest moments
    sorted_energies = sorted(energies)
    if len(sorted_energies) > 0:
        threshold = sorted_energies[int(len(sorted_energies) * 0.85)]
    else:
        threshold = 0.8
        
    print(json.dumps({
        "status": "ok",
        "window_ms": 100,
        "loud_threshold": round(threshold, 3),
        "energies": energies
    }))
