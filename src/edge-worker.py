"""Edge Neural TTS streaming worker for Skazitel.
Reads UTF-8 text from stdin, streams MP3 audio chunks to stdout.
"""
import sys
import re
import argparse
import asyncio

def clean_for_speech(text: str) -> str:
    # Strip markdown headers, bold, italics, code
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"_([^_]+)_", r"\1", text)
    text = re.sub(r"^[ \t]*#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"^[ \t]*[-*+]\s+", "", text, flags=re.MULTILINE)
    return text.strip()

async def main():
    parser = argparse.ArgumentParser(description="Edge TTS Streamer")
    parser.add_argument("--voice", default="ru-RU-DmitryNeural", help="Voice short name")
    parser.add_argument("--rate", default="+0%", help="Speaking rate")
    parser.add_argument("--pitch", default="+0Hz", help="Speaking pitch")
    args = parser.parse_args()

    raw = sys.stdin.read()
    text = clean_for_speech(raw)
    if not text:
        return

    import edge_tts
    max_retries = 3
    last_err = None

    for attempt in range(max_retries):
        try:
            communicate = edge_tts.Communicate(text, args.voice, rate=args.rate, pitch=args.pitch)
            chunk_count = 0
            async for chunk in communicate.stream():
                if chunk.get("type") == "audio" and "data" in chunk:
                    sys.stdout.buffer.write(chunk["data"])
                    sys.stdout.buffer.flush()
                    chunk_count += 1
            if chunk_count > 0:
                return
            last_err = RuntimeError("No audio chunks received")
        except Exception as err:
            last_err = err
            if "Broken pipe" in str(err) or isinstance(err, BrokenPipeError):
                sys.exit(0)
            if attempt < max_retries - 1:
                await asyncio.sleep(0.4 * (attempt + 1))

    if last_err:
        sys.stderr.write(f"EdgeTTS error: {last_err}\n")
        sys.exit(2)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, BrokenPipeError):
        sys.exit(0)
    except Exception as err:
        if "Broken pipe" in str(err) or isinstance(err, BrokenPipeError):
            sys.exit(0)
        sys.stderr.write(f"EdgeTTS error: {err}\n")
        sys.exit(1)
