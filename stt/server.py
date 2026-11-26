"""HEX 本機語音辨識服務（faster-whisper）。

- 只綁 127.0.0.1:8001，只接受帶 X-HEX: 1 標頭的請求（跨站網頁送不了自訂標頭）
- POST /transcribe：body 是一段錄音（webm / wav 等），回傳 {"text": "...", "ms": 123}
- GET  /health：{"ready": true/false, "device": "cuda"/"cpu"}
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
state = {"model": None, "device": "", "error": ""}


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
            return self._send(200, {"ready": state["model"] is not None, "device": state["device"], "error": state["error"]})
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self._allowed():
            return self._send(403, {"error": "forbidden"})
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

    def log_message(self, *_args) -> None:  # 不印每個請求
        pass


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass
    threading.Thread(target=load_model, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[stt] listening on http://{HOST}:{PORT} (model {MODEL} loading…)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
