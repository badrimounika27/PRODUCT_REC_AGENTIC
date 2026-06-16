# RECAI Product Recommendation

Agentic AI dashboard on top of a 13-step ML recommendation pipeline.

## Project layout

```
Product Recommendation/
├── backend/                  # Python API, agents, ML pipeline, data & outputs
│   ├── api/                  # FastAPI REST endpoints
│   ├── agents/               # Pipeline orchestration agents
│   ├── ai/                   # Gemini insight service
│   ├── pipeline/             # ML step scripts (01–13) + data_windows.py
│   ├── scripts/              # run_pipeline.py, build_forecast_excel_trace.py
│   ├── data/raw/             # Input transactions.csv
│   ├── outputs/              # Generated CSV artifacts (read by the API)
│   ├── config.py             # Pipeline knobs + path helpers (merged from old configs)
│   ├── requirements.txt
│   └── .env / .env.example
├── frontend/                 # React + Vite + TypeScript UI
│   ├── src/
│   └── dist/                 # Production build (npm run build)
└── archive/                  # Legacy docs, raw data prep, design HTML, .pptx, etc.
```

## Quick start

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env
# Edit .env → set GOOGLE_API_KEY=... (optional; required only for AI insight panels)

# Use the venv Python explicitly (avoid relying on global `python`):
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### Frontend

```powershell
cd frontend
npm install
npm run build
```

Open **http://127.0.0.1:8000/** — the API serves the built UI from `frontend/dist`.

For local dev with hot reload:

```powershell
# Terminal 1 — API
cd backend
.\.venv\Scripts\python.exe -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — Vite (proxies API calls to port 8000)
cd frontend
npm run dev
```

Open `http://localhost:5173/`.

## Regenerate pipeline outputs

When you replace `backend/data/raw/transactions.csv` with new data, regenerate everything from `backend/`:

```powershell
.\.venv\Scripts\python.exe scripts\run_pipeline.py
```

Or via the API (Swagger at `/docs`): `POST /pipeline/run`.

## Runtime data files

The UI reads these CSVs straight from disk on every request — no server restart needed after a fresh pipeline run:

- `backend/data/raw/transactions.csv` (input)
- `backend/outputs/recommendations_final.csv` (primary)
- `backend/outputs/clustered_data.csv`
- `backend/outputs/featured_data.csv`
- `backend/outputs/seasonality_multipliers.csv`
- `backend/outputs/promo_elasticity_by_sku_cluster.csv`
- `backend/outputs/cleaned_data.csv`
- … and the rest of the 13-step pipeline artifacts under `backend/outputs/`.
