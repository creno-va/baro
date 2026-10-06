FROM node:24-bookworm-slim@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd
# Native tools stay in this standalone service, never the Workers bundle.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pil ffmpeg poppler-utils tesseract-ocr tesseract-ocr-kor \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/file-processor/server.mjs services/file-processor/processor.py ./
USER node
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["node", "server.mjs"]
