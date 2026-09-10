"""Stateless FastAPI service, serving both the compiled React app and simulation API."""
from datetime import datetime, timezone
from pathlib import Path
import threading
import time
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .models import Facility, Injection, topology, capacity_state
from .engine import simulate, RATES, MODEL_NOTES

app = FastAPI(title='DC-Resilience API', version='1.0.0', description='Reproducible Monte Carlo data centre redundancy experiments. No paid APIs.')
# Bound concurrent CPU jobs while leaving health/topology/failure injection responsive.
slots = threading.BoundedSemaphore(2)

@app.get('/api/health')
def health():
    return {'status': 'ok', 'engine': 'NumPy continuous-time Monte Carlo', 'version': '1.0.0'}

@app.get('/api/failure-rates')
def rates():
    return {'rates': RATES, 'notes': MODEL_NOTES, 'dataset_version': '2026-09-10-mixed-v1'}

@app.post('/api/topology')
def get_topology(config: Facility):
    return capacity_state(config, topology(config), set())

@app.post('/api/inject-failure')
def inject(body: Injection):
    groups = topology(body.config)
    valid = {c['id'] for g in groups for c in g['components']}
    unknown = set(body.failed_components) - valid
    if unknown:
        raise HTTPException(422, f'Unknown component IDs: {", ".join(sorted(unknown))}')
    state = capacity_state(body.config, groups, set(body.failed_components))
    return {**state, 'downtime_minutes': 0 if state['service_maintained'] else body.duration_hours * 60,
            'duration_hours': body.duration_hours}


def experiment(config: Facility, compare: bool):
    if not slots.acquire(blocking=False):
        raise HTTPException(429, 'The simulation engine is busy. Please retry in a moment.')
    try:
        start = time.perf_counter()
        results = []
        for redundancy in ['N', 'N+1', '2N'] if compare else [None]:
            variant = config.model_copy(deep=True)
            if redundancy:
                variant.power.redundancy = variant.cooling.redundancy = redundancy
            results.append(simulate(variant))
        return {'run_id': str(uuid.uuid4()), 'created_at': datetime.now(timezone.utc).isoformat(),
                'kind': 'comparison' if compare else 'simulation', 'config': config.model_dump(),
                'duration_seconds': round(time.perf_counter()-start, 3), 'results': results,
                'dataset_version': '2026-09-10-mixed-v1', 'failure_rates': RATES,
                'model_notes': MODEL_NOTES, 'engine_version': '1.0.0'}
    finally:
        slots.release()

@app.post('/api/simulate')
def run_simulation(config: Facility):
    return experiment(config, False)

@app.post('/api/compare')
def run_comparison(config: Facility):
    return experiment(config, True)

DIST = Path(__file__).resolve().parent.parent / 'dist'
if DIST.exists():
    app.mount('/assets', StaticFiles(directory=DIST / 'assets'), name='assets')

@app.get('/{path:path}', include_in_schema=False)
def spa(path: str):
    if path.startswith('api/'):
        raise HTTPException(404, 'API route not found')
    if not DIST.exists():
        raise HTTPException(503, 'Frontend not built. Run npm run build first.')
    return FileResponse(DIST / 'index.html')
