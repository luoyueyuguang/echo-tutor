# Pronunciation sidecar (GOP-lite)

Open-source acoustic pronunciation estimate for Echo Tutor.

- Model: `facebook/wav2vec2-lv-60-espeak-cv-ft` (phoneme CTC, Apache-2.0 model card — verify before redistribution)
- Text-to-phoneme: `phonemizer` + `espeak-ng` (GPL-3.0; used as a separate service)
- Alignment: `torchaudio.functional.forced_align`
- Score: per-phone GOP = log P(canonical phone) − log max P(other phone), mapped to 0–100 with a sigmoid.

This is **not** a calibrated IELTS/TOEFL score. It is an acoustic practice estimate and is sensitive to microphone, noise and accent. Use it for relative feedback and phone-level hints.

## Run (local, recommended)

Requires Python 3.12 and `uv` (the host has both). The first run downloads CPU torch and the phoneme model (~1.5–2 GB).

```bash
./run.sh
curl http://127.0.0.1:9000/health
```

Run it in a separate terminal, or install it as a user service.

## Run (Docker, optional)

```bash
docker compose up -d --build pronunciation
curl http://127.0.0.1:9000/health
```

Docker Hub may require `docker login` for the `python:3.11-slim` base image. The local venv path avoids that.

## API

```bash
curl -F audio=@sample.wav \
     -F text="The library closes at ten on weekdays." \
     http://127.0.0.1:9000/assess
```

Response: overall `accuracy`, per-phone `score`/`gop`, per-word scores, and the lowest-scoring phones.
