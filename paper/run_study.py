"""Reproduce the manuscript's explicitly assumption-based infrastructure study.
Run from repository root with Python, numpy, scipy and pydantic installed.
"""
import csv
import gzip
import hashlib
import json
import platform
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from scipy.stats import beta

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.engine import simulate, ENGINE_VERSION, DATASET_VERSION
from backend.models import Facility, topology, capacity_state

OUT = ROOT / 'paper' / 'results'
SEEDS = [42, 2026, 745]
ARCHS = ['N', 'N+1', '2N']
SCENARIOS = {
    'baseline': {},
    'stress20': {'stress_multiplier': 20},
    'shared_bank': {'dependent_failures': True, 'common_cause_scope': 'bank'},
    'shared_site': {'dependent_failures': True, 'common_cause_scope': 'site'},
    'generator_alternative': {'generator_rate_basis': 'count_exposure'},
}


def interval(k, n):
    return [float(beta.ppf(.025, k, n-k+1)) if k else 0,
            float(beta.ppf(.975, k+1, n-k)) if k < n else 1]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    records, arrays = [], {}
    start = time.perf_counter()
    for scenario, overrides in SCENARIOS.items():
        for arch in ARCHS:
            all_d, all_energy, per_seed = [], [], []
            for seed in SEEDS:
                config = Facility(it={'enabled': False},
                    power={'redundancy': arch}, cooling={'redundancy': arch},
                    simulation={'num_trials': 10000, 'seed': seed, **overrides})
                path = OUT / f'{scenario}_{arch.replace("+", "plus")}_{seed}.json.gz'
                if path.exists():
                    with gzip.open(path, 'rt') as f:
                        saved = json.load(f)
                    result = saved['result']
                else:
                    result = simulate(config)
                    saved = {'config': config.model_dump(), 'engine': ENGINE_VERSION,
                             'dataset': DATASET_VERSION, 'result': result}
                    with gzip.open(path, 'wt') as f:
                        json.dump(saved, f, separators=(',', ':'))
                d = np.array([t['annual_downtime_minutes'] for t in result['trial_results']])
                all_d.extend(d)
                all_energy.append(result['expected_unserved_energy_kwh_per_year'])
                per_seed.append(float(d.mean()))
                print(scenario, arch, seed, 'mean minutes', d.mean(), flush=True)
            d = np.array(all_d)
            arrays[(scenario, arch)] = d
            n = len(d)
            half = 1.96 * d.std(ddof=1) / np.sqrt(n)
            k, breaches = int(np.count_nonzero(d)), int(np.count_nonzero(d > 94.608))
            row = {'scenario': scenario, 'architecture': arch, 'trials': n,
                   'downtime_minutes': float(d.mean()), 'ci_low': max(0, float(d.mean()-half)),
                   'ci_high': float(d.mean()+half), 'availability_percent': float(100*(1-d.mean()/525600)),
                   'outage_trials': k, 'outage_probability': k/n,
                   'outage_ci': interval(k, n), 'sla_breaches': breaches,
                   'sla_probability': breaches/n, 'sla_ci': interval(breaches, n),
                   'unserved_kwh': float(np.mean(all_energy)), 'seed_means': per_seed,
                   'component_count': result['component_count'], 'count_index': result['infra_cost_index'],
                   'budget_index': result['budget']['total_inr']/550000000,
                   'budget_inr': result['budget']['total_inr']}
            records.append(row)
    paired = []
    for scenario in SCENARIOS:
        for left, right in [('N', 'N+1'), ('N', '2N'), ('N+1', '2N')]:
            delta = arrays[(scenario, left)] - arrays[(scenario, right)]
            half = 1.96*delta.std(ddof=1)/np.sqrt(len(delta))
            paired.append({'scenario': scenario, 'left': left, 'right': right,
                           'reduction': float(delta.mean()), 'low': float(delta.mean()-half),
                           'high': float(delta.mean()+half), 'nonzero': int(np.count_nonzero(delta))})
    injections = []
    cases = {'one_UPS': ['UPS-A01'], 'two_UPS_same_bank': ['UPS-A01','UPS-A02'],
             'split_power_paths': ['UPS-A01','PDU-B01']}
    for arch in ARCHS:
        c = Facility(it={'enabled': False},power={'redundancy':arch},cooling={'redundancy':arch})
        ids = {u['id'] for g in topology(c) for u in g['components']}
        for name, failed in cases.items():
            if not set(failed) <= ids:
                continue
            state = capacity_state(c, topology(c), set(failed))
            injections.append({'architecture':arch,'case':name,'capacity_kw':state['surviving_capacity_kw']})
    meta = {'engine': ENGINE_VERSION, 'dataset': DATASET_VERSION,
            'source_commit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
            'engine_sha256': hashlib.sha256((ROOT/'backend/engine.py').read_bytes()).hexdigest(),
            'rates_sha256': hashlib.sha256((ROOT/'data/failure_rates.json').read_bytes()).hexdigest(),
            'seeds': SEEDS,'trials_per_seed':10000,'hours_per_trial':8760,
            'python':platform.python_version(),'numpy':np.__version__,
            'elapsed_seconds':time.perf_counter()-start,
            'scope':'Assumption-based infrastructure-only simulation; not empirical availability prediction.'}
    (OUT/'summary.json').write_text(json.dumps({'metadata':meta,'results':records,'paired':paired,'injections':injections},indent=2))
    with (OUT/'summary.csv').open('w') as f:
        writer=csv.DictWriter(f,fieldnames=list(records[0]))
        writer.writeheader(); writer.writerows(records)
    print(json.dumps({'metadata':meta,'results':records,'paired':paired,'injections':injections},indent=2))

if __name__ == '__main__':
    main()
