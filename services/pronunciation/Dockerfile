FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HOME=/models/hf \
    PRONUNCIATION_DEVICE=cpu \
    TORCH_THREADS=4

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 espeak-ng curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchaudio

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ARG MODEL_ID=facebook/wav2vec2-lv-60-espeak-cv-ft
ENV PRONUNCIATION_MODEL=${MODEL_ID}
RUN python -c "import os; from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC; m=os.environ['PRONUNCIATION_MODEL']; Wav2Vec2Processor.from_pretrained(m); Wav2Vec2ForCTC.from_pretrained(m)"

EXPOSE 9000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000"]
