#!/usr/bin/env python3
"""Cross-platform Native Messaging host for file writing and FFmpeg muxing.

All network requests stay in Chrome. This process only receives bounded base64
chunks, writes local files, and invokes FFmpeg/ffprobe.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import traceback
from typing import Any, BinaryIO, Dict, List, Optional


HOST_VERSION = "0.5.0"
MAX_MESSAGE_BYTES = 64 * 1024 * 1024
session_root: Optional[Path] = None
session_merge: Optional[Dict[str, Any]] = None
current_file: Optional[BinaryIO] = None
current_final: Optional[Path] = None
current_temporary: Optional[Path] = None


def write_message(message: Dict[str, Any]) -> None:
    payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(payload)))
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()


def read_exact(size: int) -> Optional[bytes]:
    chunks = bytearray()
    while len(chunks) < size:
        chunk = sys.stdin.buffer.read(size - len(chunks))
        if not chunk:
            return None if not chunks else bytes(chunks)
        chunks.extend(chunk)
    return bytes(chunks)


def read_message() -> Optional[Dict[str, Any]]:
    length_bytes = read_exact(4)
    if length_bytes is None:
        return None
    if len(length_bytes) != 4:
        raise EOFError("Native Messaging header was truncated")
    length = struct.unpack("<I", length_bytes)[0]
    if length <= 0 or length > MAX_MESSAGE_BYTES:
        raise ValueError(f"Invalid Native Messaging message length: {length}")
    payload = read_exact(length)
    if payload is None or len(payload) != length:
        raise EOFError("Native Messaging message was truncated")
    value = json.loads(payload.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Native Messaging payload must be an object")
    return value


def executable(name: str) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    candidates: List[Path] = []
    if sys.platform == "darwin":
        candidates.extend([Path("/opt/homebrew/bin") / name, Path("/usr/local/bin") / name])
    else:
        candidates.extend([Path("/usr/bin") / name, Path("/usr/local/bin") / name, Path.home() / ".local/bin" / name])
    return str(next((item for item in candidates if item.is_file()), "")) or None


def ffmpeg_version(ffmpeg: str) -> str:
    try:
        result = subprocess.run([ffmpeg, "-version"], check=True, capture_output=True, text=True)
        first = result.stdout.splitlines()[0].split()
        return first[2] if len(first) >= 3 else result.stdout.splitlines()[0]
    except Exception:
        return "found"


def picker_kind() -> Optional[str]:
    if sys.platform == "darwin" and shutil.which("osascript"):
        return "osascript"
    if shutil.which("zenity"):
        return "zenity"
    if shutil.which("kdialog"):
        return "kdialog"
    try:
        import tkinter  # noqa: F401
        return "tkinter"
    except Exception:
        return None


def pick_directory() -> Optional[Path]:
    kind = picker_kind()
    if kind == "osascript":
        script = 'POSIX path of (choose folder with prompt "Choose a folder for Bilibili Archive Helper")'
        result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
        value = result.stdout.strip()
        return Path(value).expanduser().resolve() if result.returncode == 0 and value else None
    if kind == "zenity":
        result = subprocess.run(["zenity", "--file-selection", "--directory", "--title=Choose Bilibili save folder"], capture_output=True, text=True)
        value = result.stdout.strip()
        return Path(value).expanduser().resolve() if result.returncode == 0 and value else None
    if kind == "kdialog":
        result = subprocess.run(["kdialog", "--getexistingdirectory", str(Path.home())], capture_output=True, text=True)
        value = result.stdout.strip()
        return Path(value).expanduser().resolve() if result.returncode == 0 and value else None
    if kind == "tkinter":
        import tkinter
        from tkinter import filedialog

        root = tkinter.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        try:
            value = filedialog.askdirectory(title="Choose Bilibili save folder", mustexist=False)
        finally:
            root.destroy()
        return Path(value).expanduser().resolve() if value else None
    raise RuntimeError("No folder picker is available. Install zenity or kdialog, then rerun the native-host installer.")


def safe_path(root: Path, relative: str) -> Path:
    if not relative or Path(relative).is_absolute():
        raise ValueError(f"Invalid relative path: {relative}")
    candidate = (root / relative.replace("\\", "/")).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as error:
        raise ValueError(f"Path escapes the selected folder: {relative}") from error
    return candidate


def replace_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(source, destination)


def write_text_atomic(destination: Path, content: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(str(destination) + ".part")
    temporary.unlink(missing_ok=True)
    try:
        with temporary.open("w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        replace_file(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def abort_file() -> None:
    global current_file, current_final, current_temporary
    if current_file is not None:
        current_file.close()
    current_file = None
    if current_temporary is not None:
        current_temporary.unlink(missing_ok=True)
    current_final = None
    current_temporary = None


def cleanup_session() -> None:
    global session_root, session_merge
    abort_file()
    session_root = None
    session_merge = None


def start_file(relative: str) -> None:
    global current_file, current_final, current_temporary
    if session_root is None:
        raise RuntimeError("No active save session")
    if current_file is not None:
        raise RuntimeError("The previous media file is still open")
    current_final = safe_path(session_root, relative)
    current_final.parent.mkdir(parents=True, exist_ok=True)
    current_temporary = Path(str(current_final) + ".part")
    current_temporary.unlink(missing_ok=True)
    current_file = current_temporary.open("wb", buffering=1024 * 1024)


def write_chunk(encoded: str) -> None:
    if current_file is None:
        raise RuntimeError("No media file is open")
    if not encoded:
        raise ValueError("Media chunk is empty")
    current_file.write(base64.b64decode(encoded, validate=True))


def finish_file() -> None:
    global current_file, current_final, current_temporary
    if current_file is None or current_final is None or current_temporary is None:
        raise RuntimeError("No media file is open")
    current_file.flush()
    os.fsync(current_file.fileno())
    current_file.close()
    current_file = None
    replace_file(current_temporary, current_final)
    current_final = None
    current_temporary = None


def normalize_m4s(source: Path) -> Path:
    with source.open("rb") as input_stream:
        if input_stream.read(9) != b"0" * 9:
            return source
        normalized = Path(str(source) + ".normalized.m4s")
        normalized.unlink(missing_ok=True)
        with normalized.open("wb") as output_stream:
            shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)
            output_stream.flush()
            os.fsync(output_stream.fileno())
        return normalized


def run_checked(arguments: List[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(arguments, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"Command exited with code {result.returncode}")
    return result


def merge_and_verify(video: Path, audio: Path, output: Path) -> None:
    ffmpeg = executable("ffmpeg")
    if not ffmpeg:
        raise FileNotFoundError("FFmpeg was not found. Rerun the native-host installer and follow its installation guidance.")
    if not video.is_file() or not audio.is_file():
        raise FileNotFoundError("The downloaded video or audio stream is missing")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = Path(str(output) + ".merging.mp4")
    temporary_output.unlink(missing_ok=True)
    normalized_video = normalize_m4s(video)
    normalized_audio = normalize_m4s(audio)
    try:
        run_checked([
            ffmpeg, "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
            "-i", str(normalized_video), "-i", str(normalized_audio),
            "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
            "-movflags", "+faststart", "-f", "mp4", str(temporary_output),
        ])
        if not temporary_output.is_file() or temporary_output.stat().st_size <= 0:
            raise RuntimeError("FFmpeg did not create a valid MP4")
        ffprobe = executable("ffprobe")
        if ffprobe:
            probe = run_checked([ffprobe, "-v", "error", "-show_entries", "stream=codec_type", "-of", "default=noprint_wrappers=1", str(temporary_output)]).stdout
            if "codec_type=video" not in probe or "codec_type=audio" not in probe:
                raise RuntimeError("Merged MP4 does not contain both video and audio streams")
        replace_file(temporary_output, output)
    finally:
        temporary_output.unlink(missing_ok=True)
        if normalized_video != video:
            normalized_video.unlink(missing_ok=True)
        if normalized_audio != audio:
            normalized_audio.unlink(missing_ok=True)


def start_session(merge: Optional[Dict[str, Any]]) -> None:
    global session_root, session_merge
    if not isinstance(merge, dict):
        raise ValueError("Merge configuration is missing")
    if not executable("ffmpeg"):
        raise FileNotFoundError("FFmpeg was not found. Rerun the native-host installer and follow its installation guidance.")
    cleanup_session()
    selected = pick_directory()
    if selected is None:
        write_message({"type": "cancelled"})
        return
    session_root = selected
    session_merge = merge
    write_message({"type": "selected", "path": str(selected)})


def complete_merge() -> None:
    global session_root, session_merge
    if session_root is None or session_merge is None:
        raise RuntimeError("No active save session")
    if current_file is not None:
        raise RuntimeError("A media file is still being written")
    video = safe_path(session_root, str(session_merge.get("videoFilename", "")))
    audio = safe_path(session_root, str(session_merge.get("audioFilename", "")))
    output_relative = str(session_merge.get("outputFilename", ""))
    output = safe_path(session_root, output_relative)
    merge_and_verify(video, audio, output)
    keep_sources = bool(session_merge.get("keepSources", True))
    if not keep_sources:
        video.unlink(missing_ok=True)
        audio.unlink(missing_ok=True)
    session_root = None
    session_merge = None
    write_message({"type": "completed", "outputFilename": output_relative, "keptSources": keep_sources})


def handle(message: Dict[str, Any]) -> None:
    action = str(message.get("action", ""))
    if action == "ping":
        ffmpeg = executable("ffmpeg")
        picker = picker_kind()
        ok = bool(ffmpeg and picker)
        if not ffmpeg:
            detail = "FFmpeg was not found. Rerun the native-host installer to install it."
        elif not picker:
            detail = "No folder picker was found. Install zenity or kdialog."
        else:
            detail = "Native host is ready"
        write_message({
            "type": "ready", "ok": ok, "helperVersion": HOST_VERSION,
            "ffmpegPath": ffmpeg or "", "ffmpegVersion": ffmpeg_version(ffmpeg) if ffmpeg else "",
            "picker": picker or "", "message": detail,
        })
        return
    if action == "startJob":
        start_session(message.get("merge"))
        return
    if session_root is None:
        raise RuntimeError("Start a save session first")
    if action == "writeText":
        write_text_atomic(safe_path(session_root, str(message.get("filename", ""))), str(message.get("content", "")))
        write_message({"type": "ack"})
    elif action == "startFile":
        start_file(str(message.get("filename", "")))
        write_message({"type": "ack"})
    elif action == "writeChunk":
        write_chunk(str(message.get("data", "")))
        write_message({"type": "ack"})
    elif action == "finishFile":
        finish_file()
        write_message({"type": "ack"})
    elif action == "abortFile":
        abort_file()
        write_message({"type": "ack"})
    elif action == "merge":
        complete_merge()
    else:
        raise ValueError(f"Unsupported action: {action}")


def protocol_main() -> int:
    try:
        while True:
            message = read_message()
            if message is None:
                cleanup_session()
                return 0
            try:
                handle(message)
            except Exception as error:
                cleanup_session()
                write_message({"type": "error", "message": str(error)})
    except BrokenPipeError:
        cleanup_session()
        return 0
    except Exception:
        cleanup_session()
        traceback.print_exc(file=sys.stderr)
        return 1


def main() -> int:
    if len(sys.argv) == 5 and sys.argv[1] == "--self-test-merge":
        merge_and_verify(Path(sys.argv[2]).resolve(), Path(sys.argv[3]).resolve(), Path(sys.argv[4]).resolve())
        print(f"Merge self-test passed: {sys.argv[4]}", file=sys.stderr)
        return 0
    if len(sys.argv) == 5 and sys.argv[1] == "--self-test-stream":
        source_video, source_audio, root = (Path(value).resolve() for value in sys.argv[2:5])
        root.mkdir(parents=True, exist_ok=True)
        global session_root, session_merge
        session_root = root
        session_merge = {
            "videoFilename": "video.m4s", "audioFilename": "audio.m4s",
            "outputFilename": "merged.mp4", "keepSources": False,
        }
        for source, relative in ((source_video, "video.m4s"), (source_audio, "audio.m4s")):
            start_file(relative)
            with source.open("rb") as stream:
                while True:
                    chunk = stream.read(256 * 1024)
                    if not chunk:
                        break
                    write_chunk(base64.b64encode(chunk).decode("ascii"))
            finish_file()
        merge_and_verify(root / "video.m4s", root / "audio.m4s", root / "merged.mp4")
        (root / "video.m4s").unlink(missing_ok=True)
        (root / "audio.m4s").unlink(missing_ok=True)
        if not (root / "merged.mp4").is_file() or (root / "video.m4s").exists() or (root / "audio.m4s").exists():
            raise RuntimeError("Streaming self-test did not leave exactly one merged MP4")
        cleanup_session()
        print(f"Streaming self-test passed: {root}", file=sys.stderr)
        return 0
    return protocol_main()


if __name__ == "__main__":
    raise SystemExit(main())
