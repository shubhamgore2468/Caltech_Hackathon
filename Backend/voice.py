import json
import os
from collections import defaultdict
from typing import Dict, List

import httpx
from anthropic import Anthropic

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en")
STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3")

SYSTEM_PROMPT = (
    "You are a warm, concise clinical check-in assistant for a Parkinson's/essential tremor "
    "monitoring app. Ask one short question at a time about the patient's day, sleep, "
    "medication, mood, and symptoms. Keep replies under 40 words. Watch for cognitive cues "
    "(confusion, word-finding trouble, repetition). When you notice anything notable, "
    "include a single JSON line at the very end like: "
    '{\"cognitive_flags\": [\"word_finding\", \"repetition\"]}. Otherwise omit it.'
)

_anthropic = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

# session_id -> list of {role, content}
_sessions: Dict[str, List[dict]] = defaultdict(list)


class VoiceConfigError(RuntimeError):
    pass


def _require_keys():
    missing = []
    if not DEEPGRAM_API_KEY:
        missing.append("DEEPGRAM_API_KEY")
    if not ANTHROPIC_API_KEY:
        missing.append("ANTHROPIC_API_KEY")
    if missing:
        raise VoiceConfigError(f"Missing env vars: {', '.join(missing)}")


async def transcribe(wav_bytes: bytes) -> str:
    url = f"https://api.deepgram.com/v1/listen?model={STT_MODEL}&smart_format=true&punctuate=true"
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": "audio/wav",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(url, headers=headers, content=wav_bytes)
        r.raise_for_status()
        data = r.json()
    try:
        return data["results"]["channels"][0]["alternatives"][0]["transcript"].strip()
    except (KeyError, IndexError):
        return ""


def chat(session_id: str, user_text: str) -> tuple[str, list]:
    if _anthropic is None:
        raise VoiceConfigError("Anthropic client not initialized (missing ANTHROPIC_API_KEY)")
    history = _sessions[session_id]
    history.append({"role": "user", "content": user_text})

    resp = _anthropic.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=history,
    )
    raw = "".join(block.text for block in resp.content if block.type == "text").strip()

    flags = []
    spoken = raw
    if raw.endswith("}"):
        brace = raw.rfind("{")
        if brace != -1:
            try:
                parsed = json.loads(raw[brace:])
                if isinstance(parsed, dict) and "cognitive_flags" in parsed:
                    flags = parsed["cognitive_flags"]
                    spoken = raw[:brace].strip()
            except json.JSONDecodeError:
                pass

    history.append({"role": "assistant", "content": raw})
    return spoken, flags


async def synthesize(text: str) -> bytes:
    if not text:
        text = "Sorry, could you repeat that?"
    url = f"https://api.deepgram.com/v1/speak?model={TTS_MODEL}&encoding=linear16&container=wav&sample_rate=24000"
    headers = {
        "Authorization": f"Token {DEEPGRAM_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(url, headers=headers, json={"text": text})
        r.raise_for_status()
        return r.content


async def voice_turn(session_id: str, wav_bytes: bytes) -> dict:
    _require_keys()
    user_text = await transcribe(wav_bytes)
    if not user_text:
        assistant_text = "I didn't catch that. Could you try again?"
        flags: list = []
    else:
        assistant_text, flags = chat(session_id, user_text)
    audio = await synthesize(assistant_text)
    return {
        "user_transcript": user_text,
        "assistant_transcript": assistant_text,
        "cognitive_flags": flags,
        "audio_wav": audio,
    }


def reset_session(session_id: str):
    _sessions.pop(session_id, None)
