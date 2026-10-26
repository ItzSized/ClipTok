#!/usr/bin/env python3
"""
face_tracker.py

Traque le visage principal (le plus grand détecté = généralement la personne qui parle)
sur une fenêtre temporelle [start, end] d'une vidéo, via OpenCV + MediaPipe Tasks API.

Usage :
    python face_tracker.py <video_path> <output_json> --start 12.5 --end 57.5 --sample-fps 2

Sortie (output_json) :
{
  "width": 1920, "height": 1080, "fps": 29.97, "faceFound": true,
  "samples": [{"t": 0.0, "cx": 960.0, "cy": 420.0}, ...]
}

`t` est relatif à --start (0 = début du clip). cx/cy sont en pixels, dans le
repère de la vidéo source. En cas d'absence de visage détecté sur une frame
échantillonnée, la dernière position connue est conservée (lissage exponentiel)
afin d'éviter les sauts brusques de la caméra virtuelle.

Note : utilise la MediaPipe Tasks API (mediapipe >= 0.10) avec un modèle .tflite
embarqué localement (scripts/models/blaze_face_short_range.tflite), donc aucun
téléchargement réseau n'est nécessaire au runtime (contrairement à l'ancienne API
`mp.solutions.face_detection`, supprimée dans mediapipe >= 1.0).
"""

import sys
import os
import json
import argparse

try:
    import cv2
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    from mediapipe.tasks.python.vision.core.vision_task_running_mode import (
        VisionTaskRunningMode,
    )
except ImportError as e:
    print(json.dumps({"error": f"Dépendance manquante ({e}). Installe requirements.txt."}), file=sys.stderr)
    sys.exit(1)

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "blaze_face_short_range.tflite")


def parse_args():
    parser = argparse.ArgumentParser(description="Face tracking pour crop vertical 9:16")
    parser.add_argument("video_path")
    parser.add_argument("output_json")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--sample-fps", type=float, default=2.0)
    return parser.parse_args()


def main():
    args = parse_args()

    if not os.path.isfile(MODEL_PATH):
        print(
            json.dumps({"error": f"Modèle de détection de visage introuvable : {MODEL_PATH}"}),
            file=sys.stderr,
        )
        sys.exit(1)

    cap = cv2.VideoCapture(args.video_path)
    if not cap.isOpened():
        print(json.dumps({"error": f"Impossible d'ouvrir la vidéo : {args.video_path}"}), file=sys.stderr)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    if width <= 0 or height <= 0:
        print(json.dumps({"error": "Dimensions vidéo invalides (fichier corrompu ?)."}), file=sys.stderr)
        cap.release()
        sys.exit(1)

    start_ms = max(0.0, args.start) * 1000.0
    end_ms = (args.end * 1000.0) if args.end is not None else (total_frames / fps * 1000.0)

    cap.set(cv2.CAP_PROP_POS_MSEC, start_ms)

    frame_interval = max(1, round(fps / max(args.sample_fps, 0.1)))

    detector_options = vision.FaceDetectorOptions(
        base_options=BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=VisionTaskRunningMode.VIDEO,
        min_detection_confidence=0.5,
    )

    samples = []
    last_cx, last_cy = width / 2.0, height / 2.0
    face_ever_found = False
    frame_idx = 0
    last_timestamp_ms = -1
    alpha = 0.35  # lissage exponentiel : évite les sauts brusques de la caméra virtuelle
    last_gray = None

    with vision.FaceDetector.create_from_options(detector_options) as detector:
        try:
            while True:
                pos_ms = cap.get(cv2.CAP_PROP_POS_MSEC)
                if pos_ms > end_ms:
                    break

                ret, frame = cap.read()
                if not ret:
                    break

                if frame_idx % frame_interval == 0:
                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))

                    # Les timestamps passés à detect_for_video doivent être strictement croissants.
                    timestamp_ms = max(int(pos_ms), last_timestamp_ms + 1)
                    last_timestamp_ms = timestamp_ms

                    result = detector.detect_for_video(mp_image, timestamp_ms)

                    # Scene detection
                    gray = cv2.cvtColor(cv2.resize(frame, (64, 64)), cv2.COLOR_BGR2GRAY)
                    scene_cut = False
                    if last_gray is not None:
                        mean_diff = np.mean(cv2.absdiff(gray, last_gray))
                        if mean_diff > 25.0:  # Seuil de cut caméra empirique
                            scene_cut = True
                    last_gray = gray

                    target_cx, target_cy = last_cx, last_cy
                    if result.detections:
                        # On garde le plus grand visage détecté (le plus proche/probable locuteur principal).
                        best = max(
                            result.detections,
                            key=lambda d: d.bounding_box.width * d.bounding_box.height,
                        )
                        box = best.bounding_box
                        target_cx = box.origin_x + box.width / 2.0
                        target_cy = box.origin_y + box.height / 2.0
                        face_ever_found = True

                    if scene_cut:
                        last_cx = target_cx
                        last_cy = target_cy
                    else:
                        last_cx = alpha * target_cx + (1 - alpha) * last_cx
                        last_cy = alpha * target_cy + (1 - alpha) * last_cy

                    t = max(0.0, (pos_ms - start_ms) / 1000.0)
                    sample = {"t": round(t, 3), "cx": round(last_cx, 1), "cy": round(last_cy, 1)}
                    if scene_cut:
                        sample["scene_cut"] = True
                    samples.append(sample)

                frame_idx += 1
        finally:
            cap.release()

    if not samples:
        samples = [{"t": 0.0, "cx": width / 2.0, "cy": height / 2.0}]

    output = {
        "width": width,
        "height": height,
        "fps": fps,
        "faceFound": face_ever_found,
        "samples": samples,
    }

    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(output, f)

    print(json.dumps({"status": "ok", "samples": len(samples), "faceFound": face_ever_found}))


if __name__ == "__main__":
    main()
