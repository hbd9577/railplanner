# RailPlanner

Decision support for planning new US passenger rail corridors (SBUHacks MVP).
Pick two cities, get 2-3 candidate routes, Monte Carlo cost/schedule ranges, funding matches, and an AI-drafted proposal.

> **Illustrative estimates.** Cost benchmarks are not calibrated; outputs are for demonstration only.

## Local dev

```bash
cp .env.example .env            # fill in DATABASE_URL (Tiger Data service URL)

# backend (on Windows keep the venv at a short path, e.g. ~/.venvs/railplanner, to avoid MAX_PATH DLL errors)
cd backend
python -m venv ~/.venvs/railplanner
~/.venvs/railplanner/Scripts/python -m pip install -r requirements.txt
~/.venvs/railplanner/Scripts/python -m app.db migrate     # apply schema + seed cities
~/.venvs/railplanner/Scripts/python -m uvicorn app.main:app --reload --port 8000

# frontend (proxies /api -> :8000)
cd frontend && npm install && npm run dev
```

## Docker

```bash
docker compose up --build       # Caddy on :80 -> /api/* to FastAPI, everything else to the static frontend
```

_Full setup, architecture diagram and demo script land in Phase 9._
