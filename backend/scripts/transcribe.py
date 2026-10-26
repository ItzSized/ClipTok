import sys
import os
import json
import argparse

# Essayer de charger les DLL CUDA téléchargées via pip
try:
    import site
    packages = site.getsitepackages()
    if hasattr(site, 'getusersitepackages'):
        packages.append(site.getusersitepackages())
    
    for sp in packages:
        nvidia_path = os.path.join(sp, "nvidia")
        if os.path.exists(nvidia_path):
            for d in os.listdir(nvidia_path):
                bin_path = os.path.join(nvidia_path, d, "bin")
                if os.path.exists(bin_path):
                    os.add_dll_directory(bin_path)
                    os.environ["PATH"] = bin_path + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

from faster_whisper import WhisperModel
import subprocess
import math
import tempfile

# Le backend passe les chemins des binaires embarqués (ffmpeg-static) : ils ne
# sont pas forcément installés dans le PATH système.
FFMPEG = os.environ.get("FFMPEG_BINARY", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_BINARY", "ffprobe")

def get_audio_duration(file_path):
    cmd = [FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
    try:
        output = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        return float(output)
    except Exception:
        return 0.0

def extract_chunk(input_path, output_path, start_time, duration):
    # -ss avant -i : seek direct dans le fichier au lieu de décoder depuis le début.
    cmd = [
        FFMPEG, "-y", "-ss", str(start_time), "-i", input_path,
        "-t", str(duration),
        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", 
        output_path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def transcribe_all(model, args, transcribe_options):
    """Transcrit tout le fichier (par tranches de 5 min) et retourne (texte, durée, langue, mots)."""
    total_duration = get_audio_duration(args.audio_path)
    chunk_duration = 5 * 60 # 5 minutes par chunk (faible empreinte RAM)

    words_list = []
    full_text = ""
    language_detected = None
    final_duration = total_duration

    if total_duration <= 0:
        # Fallback si ffprobe échoue, on fait tout d'un coup
        segments, info = model.transcribe(
            args.audio_path,
            **transcribe_options
        )
        language_detected = info.language
        final_duration = info.duration
        for segment in segments:
            full_text += segment.text + " "
            if final_duration > 0:
                progress = min(100.0, (segment.end / final_duration) * 100)
            else:
                progress = 100.0
            print(f"PROGRESS:{progress:.2f}", file=sys.stdout, flush=True)
            if segment.words:
                for word in segment.words:
                    words_list.append({
                        "word": word.word.strip(),
                        "start": round(word.start, 3),
                        "end": round(word.end, 3),
                        "probability": round(getattr(word, "probability", 1.0) or 1.0, 3)
                    })
    else:
        num_chunks = math.ceil(total_duration / chunk_duration)
        with tempfile.TemporaryDirectory() as temp_dir:
            for i in range(num_chunks):
                start_time = i * chunk_duration
                chunk_path = os.path.join(temp_dir, f"chunk_{i}.wav")
                
                # Extraction du chunk avec ffmpeg
                extract_chunk(args.audio_path, chunk_path, start_time, chunk_duration)
                
                # Transcription du chunk
                segments, info = model.transcribe(
                    chunk_path,
                    **transcribe_options
                )
                
                if language_detected is None:
                    language_detected = info.language
                    
                for segment in segments:
                    full_text += segment.text + " "
                    
                    # Calcule la progression par rapport à la durée totale
                    current_time = start_time + segment.end
                    progress = min(100.0, (current_time / total_duration) * 100)
                    print(f"PROGRESS:{progress:.2f}", file=sys.stdout, flush=True)
                    
                    if segment.words:
                        for word in segment.words:
                            words_list.append({
                                "word": word.word.strip(),
                                "start": round(start_time + word.start, 3),
                                "end": round(start_time + word.end, 3),
                                "probability": round(getattr(word, "probability", 1.0) or 1.0, 3)
                            })
                            
                # Nettoyer le chunk immédiatement pour libérer l'espace disque
                if os.path.exists(chunk_path):
                    os.remove(chunk_path)


    return full_text, final_duration, language_detected, words_list


def load_model(name, device):
    if device == "cuda":
        return WhisperModel(name, device="cuda", compute_type="float16")
    return WhisperModel(name, device="cpu", compute_type="int8")


def is_cuda_runtime_error(err):
    text = str(err).lower()
    return any(k in text for k in ("cublas", "cudnn", "cuda", "cudart"))


def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with faster-whisper")
    parser.add_argument("audio_path", help="Path to the audio file")
    parser.add_argument("output_json", help="Path to save the JSON result")
    parser.add_argument("--model", default="base", help="Whisper model size (tiny, base, small, medium, large-v3)")
    parser.add_argument("--language", default="fr", help="Language code (e.g., 'fr', 'en') or 'auto' for detection")
    parser.add_argument("--task", default="transcribe", help="Task to perform ('transcribe' or 'translate')")
    parser.add_argument("--initial_prompt", default="", help="Initial prompt to guide the model (e.g., specific vocabulary)")
    parser.add_argument("--vad_filter", action="store_true", help="Enable VAD filter (Voice Activity Detection)")
    args = parser.parse_args()

    # Tentative d'utilisation de la carte graphique NVIDIA (CUDA)
    device = "cuda"
    try:
        model = load_model(args.model, "cuda")
    except Exception as e:
        print(f"CUDA non disponible ou erreur ({e}), fallback sur CPU...", file=sys.stderr)
        device = "cpu"
        model = load_model(args.model, "cpu")

    print(f"Transcription en cours avec le modèle {args.model}...", file=sys.stderr)
    
    # Configuration des options de transcription
    transcribe_options = {
        "word_timestamps": True,
        "vad_filter": args.vad_filter,
        "task": args.task,
        "condition_on_previous_text": False # Corrige le bug de boucle infinie sur le silence sans couper à 99%
    }
    
    if args.language.lower() != "auto":
        transcribe_options["language"] = args.language
        
    if args.initial_prompt.strip():
        transcribe_options["initial_prompt"] = args.initial_prompt.strip()

    try:
        full_text, final_duration, language_detected, words_list = transcribe_all(model, args, transcribe_options)
    except RuntimeError as e:
        # Le modèle peut se charger sur le GPU alors qu'une DLL CUDA (cublas, cudnn) manque :
        # l'erreur n'apparaît qu'au premier encodage. On recommence alors sur CPU.
        if device != "cuda" or not is_cuda_runtime_error(e):
            raise
        print(f"Erreur CUDA pendant la transcription ({e}), nouvel essai sur CPU...", file=sys.stderr, flush=True)
        model = load_model(args.model, "cpu")
        full_text, final_duration, language_detected, words_list = transcribe_all(model, args, transcribe_options)

    result = {
        "text": full_text.strip(),
        "duration": final_duration,
        "language": language_detected or "fr",
        "words": words_list
    }

    with open(args.output_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        
    print(f"PROGRESS:100.00", file=sys.stdout, flush=True)
    print(f"Transcription terminée. {len(words_list)} mots trouvés.", file=sys.stderr, flush=True)

    sys.exit(0)

if __name__ == "__main__":
    main()
