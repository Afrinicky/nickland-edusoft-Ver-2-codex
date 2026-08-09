# Nickland Edusoft Cloud (Python/FastAPI) — production image
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY app ./app
COPY public ./public
COPY schema.sql ./schema.sql
COPY scripts ./scripts

# Run as a non-root user.
RUN useradd -m appuser
USER appuser

EXPOSE 8080

# Honor the platform-provided $PORT (Render/Fly/Cloud Run set it).
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${WEB_CONCURRENCY:-2}"]
