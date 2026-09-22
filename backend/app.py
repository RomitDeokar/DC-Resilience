"""Stateless FastAPI service, serving both the compiled React app and simulation API."""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import threading
import time
import uuid
from uuid import UUID
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from .operations import router as operations_router
from .models import Facility, Injection, topology, capacity_state, work_estimate
from .engine import simulate, RATES, MODEL_NOTES, paired_comparison, diagnostics, DATASET_VERSION, ENGINE_VERSION

app = FastAPI(title='DC-Resilience API', version=ENGINE_VERSION, description='Reproducible Monte Carlo data centre redundancy experiments. No paid APIs.')
# Register operations before the SPA catch-all so GET and WebSocket routes resolve.
app.include_router(operations_router)

# Bound concurrent CPU jobs while leaving health/topology/failure injection responsive.
slots = threading.BoundedSemaphore(2)
# Ephemeral counters only: no configurations/results retained. Run a single worker
# so admission and progress refer to the same process. UUIDs are opaque job handles.
progress_lock = threading.Lock()
active_progress: dict[str, dict] = {}


@app.get('/api/progress/{job_id}')
def job_progress(job_id: UUID):
    with progress_lock:
        state = active_progress.get(str(job_id))
        if state is None:
            raise HTTPException(404, 'Job is not active. Use the simulation response for its final result.')
        return dict(state)


@app.get('/api/health')
def health():
    return {'status': 'ok', 'engine': 'NumPy continuous-time Monte Carlo', 'version': ENGINE_VERSION}

@app.get('/api/failure-rates')
def rates():
    return {'rates': RATES, 'notes': MODEL_NOTES, 'dataset_version': DATASET_VERSION}

@app.post('/api/preflight')
def preflight(config: Facility, compare: bool = False):
    return work_estimate(config, compare)

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
            'duration_hours': body.duration_hours,
            'unserved_energy_kwh': state['lost_capacity_kw'] * body.duration_hours}


def experiment(config: Facility, compare: bool, job_id: UUID | None = None):
    if not slots.acquire(blocking=False):
        raise HTTPException(429, 'Two simulation jobs are already running. Your request was not started; retry after one finishes.', headers={'Retry-After': '5'})
    handle = str(job_id or uuid.uuid4())
    plan = work_estimate(config, compare)
    registered = False
    try:
        with progress_lock:
            if handle in active_progress:
                raise HTTPException(409, 'This job ID is already active. Use a new job ID.')
            active_progress[handle] = {'completed_trials': 0,
                'total_trials': plan['total_trial_evaluations'], 'phase': 'Preparing experiment'}
            registered = True

        def progress(phase, completed=0):
            with progress_lock:
                state = active_progress[handle]
                state['phase'] = phase
                state['completed_trials'] += completed

        start = time.perf_counter()
        results = []
        for redundancy in ['N', 'N+1', '2N'] if compare else [None]:
            variant = config.model_copy(deep=True)
            if redundancy:
                variant.power.redundancy = variant.cooling.redundancy = variant.it.redundancy = redundancy
            label = f'Architecture {redundancy}' if redundancy else 'Selected architecture'
            progress(label)
            results.append(simulate(variant, progress=lambda count: progress(label, count)))
        analysis = diagnostics(config, progress=progress) if config.simulation.diagnostics else None
        progress('Finalizing results and exports')
        fingerprint = hashlib.sha256(json.dumps({'kind': 'comparison' if compare else 'simulation', 'config': config.model_dump(), 'rates': RATES,
            'engine_version': ENGINE_VERSION, 'dataset_version': DATASET_VERSION},
            sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        return {'input_fingerprint': fingerprint, 'diagnostics': analysis, 'work_estimate': plan, 'run_id': handle, 'created_at': datetime.now(timezone.utc).isoformat(),
                'kind': 'comparison' if compare else 'simulation', 'config': config.model_dump(),
                'duration_seconds': round(time.perf_counter()-start, 3), 'results': results,
                'dataset_version': DATASET_VERSION, 'failure_rates': RATES,
                'model_notes': MODEL_NOTES, 'engine_version': ENGINE_VERSION,
                'paired_comparisons': paired_comparison(results) if compare else []}
    finally:
        if registered:
            with progress_lock:
                active_progress.pop(handle, None)
        slots.release()

@app.post('/api/simulate')
def run_simulation(config: Facility, job_id: UUID | None = None):
    return experiment(config, False, job_id)

@app.post('/api/compare')
def run_comparison(config: Facility, job_id: UUID | None = None):
    return experiment(config, True, job_id)

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
