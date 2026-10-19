"""A warm, CPU-only Silero worker. Protocol: JSON lines in, JSON/WAV base64 out."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import time
import wave
from voice_text import normalize, chunks, SPEAKERS

def offline_only(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo'):
        raise RuntimeError('Локальный голос не использует сетевые соединения.')

sys.addaudithook(offline_only)

def emit(data):
    sys.stdout.write(json.dumps(data, ensure_ascii=False)+'\n')
    sys.stdout.flush()

try:
    started=time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        torch.set_num_threads(min(4, os.cpu_count() or 2))
        model = torch.package.PackageImporter(sys.argv[1]).load_pickle('tts_models','model')
        model.to(torch.device('cpu'))
    emit({'ready':True, 'loadSeconds':round(time.perf_counter()-started,3)})
except Exception as error:
    emit({'fatal':'Не удалось загрузить локальный голос: '+str(error)[:400]})
    sys.exit(1)

for line in sys.stdin:
    request={}
    try:
        request=json.loads(line)
        text=request.get('text','')
        speaker=request.get('speaker','eugene')
        if not isinstance(text,str) or not text.strip() or len(text)>6000:
            raise ValueError('Для озвучивания нужна реплика длиной от 1 до 6000 символов.')
        if speaker not in SPEAKERS:
            raise ValueError('Неизвестный голос Silero.')
        text=normalize(text)
        if not text:
            raise ValueError('В реплике не осталось произносимого текста.')
        started=time.perf_counter()
        frames=[]
        with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
            for piece in chunks(text):
                samples=model.apply_tts(text=piece, speaker=speaker, sample_rate=48000,
                                        put_accent=True, put_yo=True)
                pcm=(samples.clamp(-1,1)*32767).to(torch.int16).numpy().astype('<i2').tobytes()
                if frames: frames.append(b'\x00\x00'*4800)
                frames.append(pcm)
        pcm=b''.join(frames)
        output=io.BytesIO()
        with wave.open(output,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(48000);wav.writeframes(pcm)
        emit({'id':request['id'],'audio':base64.b64encode(output.getvalue()).decode('ascii'),
              'seconds':len(pcm)/96000,'synthesisSeconds':round(time.perf_counter()-started,3)})
    except Exception as error:
        emit({'id':request.get('id'),'error':'Silero: '+str(error)[:500]})
