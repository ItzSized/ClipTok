from faster_whisper import WhisperModel
model = WhisperModel('tiny', device='cpu', compute_type='int8')
segments, info = model.transcribe('temp/test_audio.mp3', word_timestamps=True, vad_filter=True)
for segment in segments:
    print(f'Segment: {segment.start} - {segment.end}: {segment.text}')
