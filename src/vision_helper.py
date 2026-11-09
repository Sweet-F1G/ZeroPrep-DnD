#!/usr/bin/env python3
"""
vision_helper.py - Cross-platform Face & Emotion analysis for Skazitel (Windows / Linux / macOS)
Reads JPEG bytes from standard input, calculates facial landmarks (EAR, MAR, brows, smile, pose),
and outputs the exact JSON structure expected by Skazitel's DM engine.
"""

import sys
import json
import math

def main():
    try:
        raw_data = sys.stdin.buffer.read()
    except Exception as e:
        print(json.dumps({"faces": 0, "summary": f"Ошибка чтения входных данных: {e}"}, ensure_ascii=False))
        return

    if not raw_data or len(raw_data) < 100:
        print(json.dumps({"faces": 0, "summary": "Кадр пуст или повреждён"}, ensure_ascii=False))
        return

    try:
        import numpy as np
        import cv2
    except ImportError:
        print(json.dumps({
            "faces": 0,
            "summary": "Для локального зрения на Windows установите: pip install opencv-python mediapipe"
        }, ensure_ascii=False))
        return

    try:
        nparr = np.frombuffer(raw_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            print(json.dumps({"faces": 0, "summary": "Не удалось декодировать JPEG"}, ensure_ascii=False))
            return
    except Exception as e:
        print(json.dumps({"faces": 0, "summary": f"Ошибка декодирования: {e}"}, ensure_ascii=False))
        return

    # Check for MediaPipe Face Mesh
    try:
        import mediapipe as mp
        mp_face_mesh = mp.solutions.face_mesh
        with mp_face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=4,
            refine_landmarks=True,
            min_detection_confidence=0.5
        ) as face_mesh:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)
            
            if not results.multi_face_landmarks:
                print(json.dumps({
                    "faces": 0,
                    "summary": "За столом никого не видно.",
                    "attention": "empty",
                    "smiling": False,
                    "tired": False,
                    "surprised": False,
                    "tense": False,
                    "speaking": False,
                    "neutral": True,
                    "details": []
                }, ensure_ascii=False))
                return

            total_faces = len(results.multi_face_landmarks)
            player_details = []
            smiling_count = 0
            tired_count = 0
            surprised_count = 0
            tense_count = 0
            speaking_count = 0
            looking_down_count = 0
            looking_away_count = 0
            focused_count = 0

            h, w = img.shape[:2]

            for idx, face_landmarks in enumerate(results.multi_face_landmarks):
                pts = face_landmarks.landmark
                
                # Approximate Head Pose (Nose tip 1, Chin 152, Left cheek 234, Right cheek 454)
                nose = pts[1]
                chin = pts[152]
                left_cheek = pts[234]
                right_cheek = pts[454]
                
                # Yaw approximation
                dx_left = abs(nose.x - left_cheek.x)
                dx_right = abs(right_cheek.x - nose.x)
                yaw = (dx_left - dx_right) / max(0.001, dx_left + dx_right)
                
                # Pitch approximation (nose to chin vs forehead)
                forehead = pts[10]
                total_face_h = abs(chin.y - forehead.y)
                nose_rel_y = (nose.y - forehead.y) / max(0.001, total_face_h)
                pitch = nose_rel_y - 0.55  # If looking down, nose is lower relative to face

                attention = "focused"
                if pitch > 0.12:
                    attention = "looking_down"
                    looking_down_count += 1
                elif abs(yaw) > 0.40:
                    attention = "looking_away"
                    looking_away_count += 1
                else:
                    focused_count += 1

                # EAR (Eyes)
                # Left eye: 33 (corner), 133 (corner), 159 (top), 145 (bottom)
                left_w = abs(pts[133].x - pts[33].x)
                left_h = abs(pts[145].y - pts[159].y)
                left_ear = left_h / max(0.001, left_w)

                # Right eye: 362 (corner), 263 (corner), 386 (top), 374 (bottom)
                right_w = abs(pts[263].x - pts[362].x)
                right_h = abs(pts[374].y - pts[386].y)
                right_ear = right_h / max(0.001, right_w)

                avg_ear = (left_ear + right_ear) / 2.0

                # Inner lips aperture (13 top inner, 14 bottom inner, 78 left corner, 308 right corner)
                inner_w = abs(pts[308].x - pts[78].x)
                inner_h = abs(pts[14].y - pts[13].y)
                inner_aperture = inner_h / max(0.001, inner_w)

                # Outer lips aspect & corner lift (61 left, 291 right, 0 top, 17 bottom)
                mouth_w = abs(pts[291].x - pts[61].x)
                mouth_h = abs(pts[17].y - pts[0].y)
                mouth_aspect = mouth_w / max(0.001, mouth_h)
                
                corner_avg_y = (pts[61].y + pts[291].y) / 2.0
                center_lip_y = (pts[0].y + pts[17].y) / 2.0
                # In MediaPipe, y goes DOWN
                corner_lift = center_lip_y - corner_avg_y

                # Eyebrows to eye distance (left brow 70, left eye 159; right brow 300, right eye 386)
                left_brow_dist = abs(pts[70].y - pts[159].y)
                right_brow_dist = abs(pts[300].y - pts[386].y)
                avg_brow_dist = (left_brow_dist + right_brow_dist) / 2.0

                is_smiling = False
                is_tired = False
                is_surprised = False
                is_tense = False
                is_speaking = False
                is_yawning = False

                if inner_aperture > 0.45 and avg_ear < 0.20:
                    is_yawning = True
                    is_tired = True
                elif inner_aperture > 0.20:
                    is_speaking = True
                    speaking_count += 1

                if avg_brow_dist > 0.12 and avg_ear > 0.28:
                    is_surprised = True
                    surprised_count += 1
                elif avg_brow_dist < 0.05 and avg_ear >= 0.18 and not is_yawning:
                    is_tense = True
                    tense_count += 1
                elif corner_lift > 0.008 and mouth_aspect > 2.5:
                    is_smiling = True
                    smiling_count += 1
                elif avg_ear < 0.17:
                    is_tired = True
                    tired_count += 1

                is_neutral = not (is_smiling or is_tired or is_surprised or is_tense)

                expression = "neutral"
                if is_surprised: expression = "surprised"
                elif is_tense: expression = "tense"
                elif is_smiling: expression = "smiling"
                elif is_tired: expression = "tired"
                elif is_speaking: expression = "speaking"

                player_details.append({
                    "index": idx + 1,
                    "attention": attention,
                    "expression": expression,
                    "mouthOpen": is_speaking or is_yawning,
                    "smiling": is_smiling,
                    "tired": is_tired,
                    "surprised": is_surprised,
                    "tense": is_tense,
                    "yawning": is_yawning,
                    "neutral": is_neutral,
                    "yaw": round(float(yaw), 2),
                    "pitch": round(float(pitch), 2)
                })

            parts = []
            if total_faces == 1:
                parts.append("В кадре 1 игрок.")
            else:
                parts.append(f"В кадре {total_faces} игроков за столом.")

            if speaking_count > 0:
                parts.append("Кто-то активно говорит или реагирует.")

            if surprised_count > 0:
                parts.append("Игрок ошеломлён или удивлён (вскинутые брови, широко раскрытые глаза).")
            elif tense_count > 0:
                parts.append("Игрок напряжённо и сосредоточенно нахмурился, затаив дыхание в ожидании развязки.")
            elif smiling_count > 0:
                parts.append("На лицах видны улыбки и азарт.")
            elif tired_count > 0:
                parts.append("Игрок выглядит усталым (тяжёлые веки, спокойный утомлённый взгляд).")
            elif looking_down_count > 0:
                parts.append("Игрок смотрит вниз (в телефон, листы или на кубики).")
            else:
                parts.append("Игрок спокойно и внимательно слушает мастера (нейтральное, сосредоточенное выражение лица).")

            print(json.dumps({
                "faces": total_faces,
                "summary": " ".join(parts),
                "attention": "looking_down" if looking_down_count > 0 else ("looking_away" if looking_away_count > 0 else "focused"),
                "smiling": smiling_count > 0,
                "tired": tired_count > 0,
                "surprised": surprised_count > 0,
                "tense": tense_count > 0,
                "neutral": not (smiling_count or tired_count or surprised_count or tense_count),
                "speaking": speaking_count > 0,
                "distracted": looking_down_count > 0 or looking_away_count > 0,
                "details": player_details
            }, ensure_ascii=False))
            return

    except Exception as e:
        # Fallback to Haar Cascade if mediapipe is not installed
        try:
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            faces = face_cascade.detectMultiScale(gray, 1.2, 5)
            count = len(faces)
            if count == 0:
                print(json.dumps({"faces": 0, "summary": "За столом никого не видно.", "attention": "empty"}, ensure_ascii=False))
            else:
                summary = f"В кадре {count} игрок(а) за столом."
                print(json.dumps({
                    "faces": count,
                    "summary": summary,
                    "attention": "focused",
                    "smiling": False,
                    "tired": False,
                    "surprised": False,
                    "tense": False,
                    "neutral": True,
                    "speaking": False,
                    "distracted": False,
                    "details": [{"index": i + 1, "attention": "focused", "expression": "neutral"} for i in range(count)]
                }, ensure_ascii=False))
        except Exception as inner_e:
            print(json.dumps({"faces": 0, "summary": f"Ошибка анализа лиц: {inner_e}"}, ensure_ascii=False))

if __name__ == '__main__':
    main()
