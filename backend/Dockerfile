FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 1000 appuser \
    && mkdir -p /app/app/uploads /app/app/outputs /app/data/demo \
    && chown -R appuser:appuser /app

ENV DEMO_DATA_DIR=/app/data/demo
ENV INFERENCE_MODE=stub

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
