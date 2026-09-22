# DC-Resilience — Data Centre Reliability Engineering Console

> Research direction: *Quantitative evaluation of data centre redundancy architectures using failure injection and availability simulation.*

A single FastAPI + React application that combines a reproducible Monte Carlo reliability engine with a
facility operations console: infrastructure design, rack floor planning, software-stack modelling,
capacity calculators, live fault injection and synthetic DCIM telemetry.

## Modules

| Area | Page | What it does |
|---|---|---|
| Facility operations | Operations overview | Applied facility design, subsystem readiness, KPIs |
| | Infrastructure designer | Utility feeds, UPS, generators, ATS/PDU, cooling plant, network — explicit unit counts |
| | **Rack floor planner** | Place racks on a row/column grid, move them, edit each rack's elevation (U-slots), power feed (A/B/AB), cooling zone and power limit; per-rack load, utilisation and free U; feed/zone/rack outages |
| | **Software stack & threats** | Services (hypervisor → database → application …) with replica hosts, minimum replicas and dependencies; hardware host failures; virus / worm / ransomware / misconfiguration / bad-patch propagation across network segments; segmentation, endpoint protection and backup controls; findings |
| | Resilience assessment | Design-readiness score, single-failure margins, educational Tier notes |
| | Capacity calculators | Power & UPS, cooling (kW / BTU/hr / tons), rack density, PUE, WUE, SLA downtime budget |
| | Facility fault explorer | React Flow dependency graph, scenario library, single-point-of-failure sweep, audit trail |
| | DCIM monitor | WebSocket synthetic telemetry with threshold alerts |
| Reliability research | Simulation workspace | Monte Carlo trials, progress, results dashboard, exports and printable report |
| | Live failure lab | Deterministic injection on the capacity-aware topology |
| | Architecture comparison | N vs N+1 vs 2N under identical random streams |
| | Run history | Local IndexedDB history |

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Engine status |
| `POST` | `/api/simulate`, `/api/compare`, `/api/preflight` | Monte Carlo experiments |
| `POST` | `/api/topology`, `/api/inject-failure` | Capacity-aware topology and deterministic injection |
| `POST` | `/api/infrastructure/analyze` | Facility design validation and readiness score |
| `POST` | `/api/calculations/{power,cooling,racks,pue,wue,sla}` | Engineering calculators |
| `POST` | `/api/operations/failure`, `/api/operations/scenarios`, `/api/operations/sweep` | Facility fault explorer |
| `POST` | `/api/racks/evaluate` | Validate a floor plan; per-rack load, U-space, feed/zone outage impact |
| `GET` | `/api/software/default`, `/api/software/catalog` | Reference layout, services and threat catalogue |
| `POST` | `/api/software/evaluate` | Dependency resolution, host state and threat propagation |
| `WS` | `/ws/telemetry` | Synthetic telemetry stream |

Interactive docs: `/docs`.

## Run locally

```bash
pip install -r requirements.txt
npm ci && npm run build
uvicorn backend.app:app --host 0.0.0.0 --port 8000      # serves API + built frontend
# development: npm run dev (Vite proxy to :8000)
python -m pytest tests -q
```

Docker: `docker compose up --build` (single image, port 8000).

## Modelling notes

- All engines are deterministic or seeded; no pre-computed reliability scores.
- Rack planner checks power and U-space per rack. Airflow, weight and cabling are not modelled.
- Software threats propagate hop-by-hop over hosts you place: worms cross segments only when segmentation is off, viruses are blocked by endpoint protection, patched hosts resist viruses/worms, ransomware on stateful services without backups becomes data loss. Recovery hours are editable planning assumptions.
- Educational Tier notes only — no Tier certification claim. Failure rates are mixed-source assumptions (see Reference library).

SRM IST · Romit Deokar & Shourya Saran
