import json
from faster_whisper import WhisperModel
model = WhisperModel('tiny', device='cpu', compute_type='int8')
segments, info = model.transcribe('temp/test_android.mp4', word_timestamps=True, vad_filter=True)
print('info.duration:', info.duration)
