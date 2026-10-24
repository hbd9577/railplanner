FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY sql ./sql
COPY data ./data

EXPOSE 8000
# Apply schema (idempotent) then serve. Migration failure doesn't block startup: demo cache still works.
CMD ["sh", "-c", "python -m app.db migrate || echo 'migration failed; continuing'; exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]
