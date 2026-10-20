import math
import os
import re
import subprocess
import tempfile
from typing import Any

import numpy as np
import soundfile as sf
import torch
import torchaudio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from phonemizer.backend import EspeakBackend
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL_ID = os.getenv("PRONUNCIATION_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft")
DEVICE = os.getenv("PRONUNCIATION_DEVICE", "cpu")
MAX_SECONDS = float(os.getenv("PRONUNCIATION_MAX_SECONDS", "60"))
UNK_TOKEN = "<unk>"
SPECIAL_TOKENS = {"<s>", "</s>", "<pad>", "<unk>"}
# Accept common British/American allophones when scoring; the canonical phone is
# still what the forced aligner uses.
PHONE_VARIANTS = {
    "əʊ": ("oʊ",),
    "oʊ": ("əʊ",),
    "ɒ": ("ɔ", "ɔː"),
    "ɔ": ("ɒ", "ɔː"),
    "ɔː": ("ɔ",),
    "a": ("æ",),
    "æ": ("a",),
    "ɹ": ("r",),
    "r": ("ɹ",),
}

torch.set_num_threads(int(os.getenv("TORCH_THREADS", "4")))
processor = Wav2Vec2Processor.from_pretrained(MODEL_ID)
model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID).to(DEVICE).eval()
vocab: dict[str, int] = processor.tokenizer.get_vocab()
unk_id = vocab.get(UNK_TOKEN, 3)
phoneme_symbols = sorted(
    [token for token in vocab if token not in SPECIAL_TOKENS and token.strip()],
    key=len,
    reverse=True,
)
phonemizer = EspeakBackend(language="en-gb", preserve_punctuation=False, with_stress=False)

app = FastAPI(title="Echo Tutor pronunciation (GOP-lite)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


def segment_phones(raw: str) -> list[str]:
    """Split espeak IPA into the longest tokens present in the model vocab."""
    text = raw.replace("ˈ", "").replace("ˌ", "").replace(" ", "").strip()
    out: list[str] = []
    index = 0
    while index < len(text):
        matched = None
        for symbol in phoneme_symbols:
            if text.startswith(symbol, index):
                matched = symbol
                break
        if matched is None:
            out.append(text[index])
            index += 1
        else:
            out.append(matched)
            index += len(matched)
    return out


def decode_audio(data: bytes) -> np.ndarray:
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, "input")
        dst = os.path.join(tmp, "output.wav")
        with open(src, "wb") as handle:
            handle.write(data)
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", src, "-ar", "16000", "-ac", "1", "-f", "wav", dst],
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as exc:
            raise HTTPException(status_code=400, detail="Cannot decode audio.") from exc
        audio, sample_rate = sf.read(dst, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sample_rate != 16000:
        raise HTTPException(status_code=400, detail=f"Unexpected sample rate: {sample_rate}")
    if len(audio) < 1600:
        raise HTTPException(status_code=400, detail="Audio is too short.")
    if len(audio) > MAX_SECONDS * 16000:
        raise HTTPException(status_code=413, detail="Audio is too long.")
    return np.asarray(audio, dtype=np.float32)


def assess(audio: np.ndarray, text: str) -> dict[str, Any]:
    words = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", text)
    if not words:
        raise HTTPException(status_code=400, detail="Reference text has no English words.")

    target_ids: list[int] = []
    phones: list[dict[str, Any]] = []
    word_spans: list[dict[str, Any]] = []

    for word in words:
        phonemes = phonemizer.phonemize([word])[0]
        symbols = segment_phones(phonemes)
        if not symbols:
            continue
        start = len(target_ids)
        for symbol in symbols:
            known = symbol in vocab and symbol not in SPECIAL_TOKENS
            target_ids.append(vocab.get(symbol, unk_id))
            phones.append({"phone": symbol, "word": word, "known": known})
        word_spans.append({"word": word, "start": start, "end": len(target_ids)})

    if not target_ids:
        raise HTTPException(status_code=400, detail="Could not derive phonemes from text.")

    inputs = processor(audio, sampling_rate=16000, return_tensors="pt")
    input_values = inputs.input_values.to(DEVICE)
    with torch.inference_mode():
        logits = model(input_values).logits
        log_probs = torch.log_softmax(logits, dim=-1).contiguous()

    frame_count = log_probs.shape[1]
    if frame_count < len(target_ids):
        raise HTTPException(status_code=400, detail="Recording is too short for this sentence.")

    targets = torch.tensor([target_ids], dtype=torch.int32, device=DEVICE)
    try:
        alignments, _ = torchaudio.functional.forced_align(log_probs, targets, blank=0)
    except Exception as exc:  # noqa: BLE001 - surface a useful API error
        raise HTTPException(status_code=422, detail=f"Alignment failed: {exc}") from exc

    alignment = alignments[0].detach().cpu().tolist()
    probs = log_probs[0].detach().cpu()
    blank_id = 0
    frame_step = 0.02  # wav2vec2 conv stack: 320 samples at 16 kHz

    # forced_align returns token ids (0 = blank), not target indices. Group
    # contiguous frames into runs and map the runs to target occurrences.
    runs: list[tuple[int, list[int]]] = []
    current_token: int | None = None
    current_frames: list[int] = []
    for frame, token in enumerate(alignment):
        if token == blank_id:
            continue
        if token == current_token:
            current_frames.append(frame)
        else:
            if current_token is not None:
                runs.append((current_token, current_frames))
            current_token = token
            current_frames = [frame]
    if current_token is not None:
        runs.append((current_token, current_frames))

    run_frames: dict[int, list[int]] = {}
    run_index = 0
    for target_index, token_id in enumerate(target_ids):
        if run_index < len(runs) and runs[run_index][0] == token_id:
            run_frames[target_index] = runs[run_index][1]
            run_index += 1
            continue
        # A skipped phone or a repeated run: look ahead a little before giving up.
        for look in range(run_index, min(len(runs), run_index + 4)):
            if runs[look][0] == token_id:
                run_frames[target_index] = runs[look][1]
                run_index = look + 1
                break

    known_scores: list[float] = []
    for index, phone in enumerate(phones):
        frames = run_frames.get(index, [])
        if not frames:
            score = 0.0
            gop = -6.0
        else:
            positions = torch.tensor(frames, dtype=torch.long)
            token_id = target_ids[index]
            variant_ids = [token_id] + [
                vocab[v] for v in PHONE_VARIANTS.get(phone["phone"], ()) if v in vocab
            ]
            frame_probs = probs[positions]
            target_logp = frame_probs[:, variant_ids].max(dim=-1).values.mean()
            others = frame_probs.clone()
            others[:, variant_ids] = -1e9
            others[:, blank_id] = -1e9
            max_other = others.max(dim=-1).values.mean()
            gop = float((target_logp - max_other).item())
            score = 100.0 / (1.0 + math.exp(-gop))
        phone["score"] = round(score, 1)
        phone["gop"] = round(gop, 3)
        phone["start"] = round(float(frames[0]) * frame_step, 3) if frames else None
        phone["end"] = round(float(frames[-1] + 1) * frame_step, 3) if frames else None
        if phone["known"]:
            known_scores.append(score)

    word_scores: list[dict[str, Any]] = []
    for span in word_spans:
        span_phones = [
            phones[index]
            for index in range(span["start"], span["end"])
            if phones[index]["known"]
        ]
        score = round(sum(item["score"] for item in span_phones) / len(span_phones), 1) if span_phones else 0.0
        word_scores.append({"word": span["word"], "score": score})

    accuracy = round(sum(known_scores) / len(known_scores), 1) if known_scores else 0.0
    mispronounced = sorted(
        [phone for phone in phones if phone["known"] and phone["score"] < 55],
        key=lambda item: item["score"],
    )[:12]

    return {
        "accuracy": accuracy,
        "phones": phones,
        "words": word_scores,
        "mispronounced": mispronounced,
        "model": MODEL_ID,
        "durationSec": round(len(audio) / 16000, 2),
        "note": "GOP-lite from a phoneme CTC model; for practice feedback only, not a calibrated IELTS/TOEFL score.",
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "model": MODEL_ID, "device": DEVICE, "vocab": len(vocab)}


@app.post("/assess")
async def assess_endpoint(
    audio: UploadFile = File(...),
    text: str = Form(...),
) -> dict[str, Any]:
    if not text.strip():
        raise HTTPException(status_code=400, detail="Reference text is required.")
    if len(text) > 600:
        raise HTTPException(status_code=400, detail="Reference text is too long.")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(data) > 25_000_000:
        raise HTTPException(status_code=413, detail="Audio file is too large.")
    return assess(decode_audio(data), text)
