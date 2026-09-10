"""Continuous-time renewal Monte Carlo with an exact failure/repair event sweep."""
import json
import math
from pathlib import Path
from collections import Counter
import numpy as np
from scipy.stats import beta
from .models import Facility, TIERS, topology, capacity_state

RATES = json.loads((Path(__file__).resolve().parent.parent / 'data/failure_rates.json').read_text())
RATE_MAP = {r['component']: r for r in RATES}
MODEL_NOTES = [
    'Mixed source dataset: 3 IEEE-493-citing secondary-source records; 2 explicitly illustrative records. Not publication-ready evidence.',
    'Independent exponential operating lifetimes; constant repairs at MTTR; perfect repair; all components healthy at t=0.',
    'Islanded operation continuously requires generator capacity. Utility mode assumes a perfectly available grid and ignores generator outages.',
    '2N has independent A/B power trains and A/B cooling trains, without cross-ties. N+1 pools one spare per component group.',
    'No common-cause/correlated failures, failure-to-start, fuel exhaustion, battery discharge, maintenance, switching delay, or thermal transients.',
    'Tier-associated percentages are historical illustrative SLA benchmarks, not Uptime Institute Tier certification or guarantees.',
    'Cost index is equal-weight installed component count relative to N; not a financial quotation.',
    'Sample-mean 95% normal intervals are approximate and unreliable for very rare outages; zero observed downtime is not proof of perfect reliability.'
]


def sample_failure_time(component_type: str, rng: np.random.Generator, multiplier: int = 1) -> float:
    return float(rng.exponential(8760 / (RATE_MAP[component_type]['failure_rate_per_year'] * multiplier)))


def evaluate_events(config: Facility, groups: list[dict], events: list[tuple], hours: float, capture=False):
    """Process repairs before failures at equal timestamps; integrate the union of outages."""
    failed = set()
    last = 0.0
    down = 0.0
    energy = 0.0
    minimum = config.it_load_kw
    overlap = False
    state = capacity_state(config, groups, failed)
    samples = []
    for time, action, cid, kind in sorted(events):
        t = min(time, hours)
        dt = max(0.0, t - last)
        if not state['service_maintained']:
            down += dt
        energy += state['lost_capacity_kw'] * dt
        if time > hours:
            last = hours
            break
        if action == 1:
            failed.add(cid)
            overlap = overlap or len(failed) > 1
        else:
            failed.discard(cid)
        state = capacity_state(config, groups, failed)
        minimum = min(minimum, state['surviving_capacity_kw'])
        if capture and action == 1:
            samples.append({'component': cid, 'kind': kind, 'time_hours': round(t, 4),
                            'duration_hours': RATE_MAP[kind]['mttr_hours'],
                            'active_failures': len(failed),
                            'surviving_capacity_kw': state['surviving_capacity_kw'],
                            'service_maintained': state['service_maintained']})
        last = t
    if last < hours:
        dt = hours - last
        if not state['service_maintained']:
            down += dt
        energy += state['lost_capacity_kw'] * dt
    return down, energy, minimum, overlap, samples


def simulate(config: Facility) -> dict:
    groups = topology(config)
    sim = config.simulation
    n = sim.num_trials
    hours = sim.simulated_years_per_trial * 8760
    events: list[list[tuple]] = [[] for _ in range(n)]
    failures = Counter()
    # Each stable component ID gets its own stream, shared across comparisons for variance reduction.
    components = [c for group in groups for c in group['components']]
    for group_index, group in enumerate(groups):
        if sim.operating_mode == 'utility' and group['kind'] == 'GENERATOR':
            continue
        rate = RATE_MAP[group['kind']]
        for index, c in enumerate(group['components']):
            # A streams are stable as topology changes; B has a distinct namespace.
            bank_index = 0 if c['bank'] == 'A' else 1
            unit_index = int(c['id'][-2:])
            rng = np.random.default_rng(np.random.SeedSequence([sim.seed, group_index, bank_index, unit_index]))
            scale = 8760 / (rate['failure_rate_per_year'] * sim.stress_multiplier)
            times = rng.exponential(scale, n)
            active = np.flatnonzero(times < hours)
            while active.size:
                for trial in active:
                    t = float(times[trial])
                    events[trial].append((t, 1, c['id'], c['kind']))
                    events[trial].append((t + rate['mttr_hours'], 0, c['id'], c['kind']))
                times[active] += rate['mttr_hours'] + rng.exponential(scale, active.size)
                active = active[times[active] < hours]
    downtime = np.zeros(n)
    unserved = np.zeros(n)
    minima = np.full(n, config.it_load_kw)
    overlaps = 0
    sample_events = []
    for i, trial_events in enumerate(events):
        if sim.failure_mode == 'single':
            # Controlled non-overlapping baseline: suppress starts while another unit is under repair.
            accepted = []
            busy_until = -1.0
            for t, action, cid, kind in sorted(trial_events):
                if action == 1 and t >= busy_until:
                    busy_until = t + RATE_MAP[kind]['mttr_hours']
                    accepted.extend([(t, 1, cid, kind), (busy_until, 0, cid, kind)])
            trial_events = accepted
        for _, action, _, kind in trial_events:
            if action == 1:
                failures[kind] += 1
        down, energy, minimum, overlap, samples = evaluate_events(config, groups, trial_events, hours, len(sample_events) < 60)
        downtime[i], unserved[i], minima[i] = down, energy, minimum
        overlaps += int(overlap)
        sample_events.extend([{**s, 'trial_id': i+1} for s in samples][:max(0, 60-len(sample_events))])
    annual_minutes = downtime * 60 / sim.simulated_years_per_trial
    availability = 100 * (1 - downtime / hours)
    target = TIERS[config.tier_target]
    mean = float(np.mean(availability))
    se = float(np.std(availability, ddof=1) / math.sqrt(n))
    outage_trials = int(np.count_nonzero(downtime))
    breach_count = int(np.count_nonzero(availability < target))
    # Exact Clopper-Pearson interval for the probability of at least one outage in a trial.
    lower = float(beta.ppf(.025, outage_trials, n-outage_trials+1)) if outage_trials else 0.0
    upper = float(beta.ppf(.975, outage_trials+1, n-outage_trials)) if outage_trials < n else 1.0
    cumulative = np.cumsum(availability)
    convergence = [{'trials': int(k), 'availability': float(cumulative[k-1]/k)}
                   for k in np.unique(np.linspace(max(1, n//50), n, 50).astype(int))]
    bins = [0, 1, 15, 60, 240, 1440, float('inf')]
    histogram = [{'range': 'No outage', 'trials': int(np.sum(annual_minutes == 0))}]
    labels = ['< 1 min', '1–15 min', '15–60 min', '1–4 hrs', '4–24 hrs', '> 24 hrs']
    for j, label in enumerate(labels):
        histogram.append({'range': label, 'trials': int(np.sum((annual_minutes > bins[j]) & (annual_minutes <= bins[j+1])))})
    base = config.model_copy(deep=True)
    base.power.redundancy = base.cooling.redundancy = 'N'
    base_count = sum(len(g['components']) for g in topology(base))
    topology_name = config.power.redundancy if config.power.redundancy == config.cooling.redundancy else f'{config.power.redundancy} / {config.cooling.redundancy}'
    return {
        'redundancy': topology_name, 'trials_run': n, 'seed': sim.seed,
        'simulated_years': n * sim.simulated_years_per_trial,
        'availability_percent': mean, 'availability_ci95': [max(0, mean-1.96*se), min(100, mean+1.96*se)],
        'expected_annual_downtime_minutes': float(np.mean(annual_minutes)),
        'p95_annual_downtime_minutes': float(np.quantile(annual_minutes, .95)),
        'sla_target_percent': target, 'sla_breaches': breach_count,
        'sla_breach_rate_percent': 100 * breach_count / n, 'meets_sla': mean >= target,
        'outage_trials': outage_trials, 'outage_probability_ci95': [lower, upper],
        'service_survival_percent': 100 * (n-outage_trials)/n,
        'overlap_trials': overlaps, 'total_failure_events': sum(failures.values()),
        'expected_unserved_energy_kwh_per_year': float(np.mean(unserved)/sim.simulated_years_per_trial),
        'worst_surviving_capacity_kw': float(np.min(minima)),
        'infra_cost_index': len(components) / base_count, 'component_count': len(components),
        'convergence': convergence, 'histogram': histogram,
        'failure_breakdown': [{'component': r['label'], 'kind': r['component'], 'failures': failures[r['component']]} for r in RATES],
        'sample_events': sample_events,
        'trial_results': [{'trial_id': i+1, 'availability_percent': float(availability[i]),
                           'annual_downtime_minutes': float(annual_minutes[i]),
                           'service_maintained': bool(downtime[i] == 0),
                           'minimum_capacity_kw': float(minima[i])} for i in range(n)],
        'topology': groups
    }
