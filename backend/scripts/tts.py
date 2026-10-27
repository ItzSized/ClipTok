"""
tts.py — synthèse vocale gratuite (voix neuronales Microsoft Edge, sans clé).

Usage : python tts.py <voix> <débit> <hauteur> <fichier_texte> <sortie.mp3> <sortie_mots.json>
Écrit le MP3 et la liste des mots avec leurs temps ({text, start, end} en secondes),
ce qui permet de créer les sous-titres de la voix off sans transcription Whisper.
"""
import asyncio
import json
import sys

import edge_tts


async def main():
    voice, rate, pitch, text_file, out_audio, out_words = sys.argv[1:7]
    with open(text_file, encoding="utf-8") as f:
        text = f.read().strip()
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(out_audio, "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({"text": chunk["text"], "start": round(start, 3), "end": round(start + chunk["duration"] / 1e7, 3)})
    with open(out_words, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)


if __name__ == "__main__":
    asyncio.run(main())
