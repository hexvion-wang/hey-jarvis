"""HEX 本機語音服務：語音辨識（faster-whisper）＋唸出來（Kokoro 中文男聲）。

- 只綁 127.0.0.1:8001，只接受帶 X-HEX: 1 標頭的請求（跨站網頁送不了自訂標頭）
- POST /transcribe：body 是一段錄音（webm / wav 等），回傳 {"text": "...", "ms": 123}
- POST /speak：body 是 {"text": "...", "voice": "zm_034"}，回傳 WAV 語音
- GET  /health：{"ready": true/false, "device": "cuda"/"cpu", "tts": true/false}
- 不存檔、不上網（模型第一次啟動時會從 Hugging Face 下載，之後用本機快取）
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("HEX_STT_PORT", "8001"))
MODEL = os.environ.get("HEX_STT_MODEL", "large-v3-turbo")
MAX_BYTES = 10 * 1024 * 1024


def _add_cuda_dlls() -> None:
    """Windows：把 pip 裝的 NVIDIA cuBLAS / cuDNN 的 DLL 資料夾加進搜尋路徑。"""
    try:
        import nvidia  # type: ignore
    except ImportError:
        return
    for base in nvidia.__path__:
        for sub in ("cublas", "cudnn", "cuda_nvrtc", "cuda_runtime"):
            d = Path(base) / sub / "bin"
            if d.is_dir():
                os.add_dll_directory(str(d))
                os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")


_add_cuda_dlls()

from faster_whisper import WhisperModel  # noqa: E402
from opencc import OpenCC  # noqa: E402

# 給 Whisper 的提示：用繁體中文、常見的指令與程式名稱（提高這些字的辨識率）
PROMPT = (
    "以下是繁體中文的語音指令。幫我打開 ChatGPT、開啟 Claude、打開 Obsidian、打開 Chrome、"
    "開 Discord、開 Steam、開英雄聯盟、開鳴潮、打開 Word、Excel、PowerPoint、檔案總管、終端機。"
    "今天日報的重點是什麼？"
)
HOTWORDS = "HEX ChatGPT Claude Obsidian Chrome Discord Steam Word Excel PowerPoint 英雄聯盟 鳴潮 檔案總管 終端機 日報"

# Whisper 在沒聲音時常會「幻聽」出這些句子
HALLUCINATIONS = re.compile(
    r"(字幕|訂閱|點贊|點讚|按讚|謝謝(大家|收看|觀看)|請不吝|明鏡|by\s*\w+|Amara|中文字幕)", re.I
)

s2t = OpenCC("s2twp")  # 簡體 → 台灣繁體（含常用詞）
state = {"model": None, "device": "", "error": "", "tts": None, "g2p": None}
TTS_DIR = Path(__file__).parent / "models"
TTS_VOICE = os.environ.get("HEX_TTS_VOICE", "zm_034")
tts_lock = threading.Lock()


def load_tts() -> None:
    """Kokoro 中文語音（CPU 就夠快）。模型檔不在就跳過，只有辨識功能。"""
    onnx = TTS_DIR / "kokoro-v1.1-zh.onnx"
    voices = TTS_DIR / "voices-v1.1-zh.bin"
    if not onnx.exists() or not voices.exists():
        print("[tts] 找不到 Kokoro 模型，略過語音輸出", flush=True)
        return
    try:
        t0 = time.time()
        import shutil

        import espeakng_loader
        from kokoro_onnx import Kokoro
        from kokoro_onnx.config import EspeakConfig

        # espeak-ng（英文發音）是舊的 C 程式，讀不了有中文或空白的路徑（專案資料夾「Hey 賈維斯」），
        # 所以把它的資料複製到純英文路徑再用
        data = Path(os.environ.get("LOCALAPPDATA", tempfile.gettempdir())) / "HEX" / "espeak-ng-data"
        if not (data / "phontab").exists():
            shutil.copytree(espeakng_loader.get_data_path(), data, dirs_exist_ok=True)
        espeak = EspeakConfig(lib_path=espeakng_loader.get_library_path(), data_path=str(data))
        from misaki import zh

        k = Kokoro(str(onnx), str(voices), espeak_config=espeak)
        # 中文用 misaki；夾在句子裡的英文（ChatGPT、Discord）交給 Kokoro 內建的 espeak 英文發音
        g2p = zh.ZHG2P(version="1.1", en_callable=lambda en: k.tokenizer.phonemize(en, lang="en-us"))
        state.update(tts=k, g2p=g2p)
        synth("系統上線。")  # 暖機
        print(f"[tts] Kokoro ready ({time.time() - t0:.1f}s)", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[tts] failed: {exc}", flush=True)


# 唸之前先整理文字：拿掉 Markdown 符號、表情符號、網址
_MD = re.compile(r"(\*\*|__|`+|^#+\s*|^\s*[-*•]\s+|^\s*\d+\.\s+|\[\[[^\]]*\]\]|https?://\S+)", re.M)
_EMOJI = re.compile("[\U0001F000-\U0001FFFF\u2600-\u27BF\uFE0F]")


def clean_for_speech(text: str) -> str:
    text = _MD.sub("", text)
    text = _EMOJI.sub("", text)
    text = re.sub(r"\s*\n+\s*", "。", text.strip())
    text = re.sub(r"[。]{2,}", "。", text)
    return text[:400]


def synth(text: str, voice: str = TTS_VOICE, speed: float = 1.0) -> bytes:
    import io
    import wave

    import numpy as np

    k, g2p = state["tts"], state["g2p"]
    text = clean_for_speech(text)
    if not text:
        return b""
    with tts_lock:
        phonemes, _ = g2p(text)
        samples, sr = k.create(phonemes, voice=voice, speed=speed, is_phonemes=True)
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def load_model() -> None:
    for device, compute in (("cuda", "float16"), ("cpu", "int8")):
        try:
            t0 = time.time()
            m = WhisperModel(MODEL, device=device, compute_type=compute)
            # 暖機一次，第一句就不會卡
            silence = Path(tempfile.gettempdir()) / "hex-stt-warmup.wav"
            _write_silence(silence)
            list(m.transcribe(str(silence), language="zh")[0])
            state.update(model=m, device=device, error="")
            print(f"[stt] {MODEL} ready on {device} ({time.time() - t0:.1f}s)", flush=True)
            return
        except Exception as exc:  # noqa: BLE001
            state["error"] = f"{device}: {exc}"
            print(f"[stt] {device} failed: {exc}", flush=True)


def _write_silence(path: Path) -> None:
    import struct
    import wave

    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(struct.pack("<h", 0) * 16000)


def transcribe(audio: bytes, suffix: str) -> str:
    m = state["model"]
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        with tmp:
            tmp.write(audio)
        segments, _info = m.transcribe(
            tmp.name,
            language="zh",
            initial_prompt=PROMPT,
            hotwords=HOTWORDS,
            beam_size=5,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
        )
        parts = [s.text for s in segments if s.no_speech_prob < 0.7]
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
    text = s2t.convert("".join(parts).strip())
    if HALLUCINATIONS.search(text) and len(text) < 30:
        return ""
    return text


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _allowed(self) -> bool:
        return self.headers.get("X-HEX") == "1" and not self.headers.get("Origin")

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            return self._send(
                200,
                {"ready": state["model"] is not None, "device": state["device"], "error": state["error"], "tts": state["tts"] is not None},
            )
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
        if self.path == "/speak":
            return self._speak()
        if self.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        if state["model"] is None:
            return self._send(503, {"error": "loading"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._send(400, {"error": "bad size"})
        audio = self.rfile.read(n)
        ctype = self.headers.get("Content-Type", "")
        suffix = ".wav" if "wav" in ctype else ".ogg" if "ogg" in ctype else ".webm"
        t0 = time.time()
        try:
            text = transcribe(audio, suffix)
        except Exception as exc:  # noqa: BLE001
            print(f"[stt] error: {exc}", flush=True)
            return self._send(500, {"error": str(exc)})
        ms = int((time.time() - t0) * 1000)
        print(f"[stt] {ms}ms: {text}", flush=True)
        self._send(200, {"text": text, "ms": ms})

    def _speak(self) -> None:
        if state["tts"] is None:
            return self._send(503, {"error": "tts not ready"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 20000:
            return self._send(400, {"error": "bad size"})
        try:
            body = json.loads(self.rfile.read(n).decode("utf-8"))
            voice = str(body.get("voice") or TTS_VOICE)
            if not re.fullmatch(r"z[mf]_\d{3}", voice):
                voice = TTS_VOICE
            t0 = time.time()
            wav = synth(str(body.get("text", "")), voice, float(body.get("speed") or 1.0))
        except Exception as exc:  # noqa: BLE001
            print(f"[tts] error: {exc}", flush=True)
            return self._send(500, {"error": str(exc)})
        print(f"[tts] {int((time.time() - t0) * 1000)}ms {len(wav) // 1024}KB", flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)

    def log_message(self, *_args) -> None:  # 不印每個請求
        pass


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    threading.Thread(target=load_model, daemon=True).start()
    threading.Thread(target=load_tts, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[stt] listening on http://{HOST}:{PORT} (model {MODEL} loading…)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
