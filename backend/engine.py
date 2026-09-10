"""Continuous-time renewal Monte Carlo with an exact failure/repair event sweep."""
import json
import math
from pathlib import Path
from collections import Counter
import numpy as np
from scipy.stats import beta
from .models import Facility, TIERS, topology, capacity_state, CapacityTracker

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
    'Sample-mean 95% normal intervals are approximate; fewer than 30 outage trials triggers an evidence warning. With zero outages a conservative availability bound is derived from exact trial-outage risk.',
    'SLA breach probability is measured over the full trial horizon, not separately for each calendar year. All year-labelled downtime is annualized.',
    'Trial replay selects the highest-downtime trial (first tie), not a representative or typical year.'
]


def sample_failure_time(component_type: str, rng: np.random.Generator, multiplier: int = 1) -> float:
    return float(rng.exponential(8760 / (RATE_MAP[component_type]['failure_rate_per_year'] * multiplier)))


def exact_probability_interval(count: int, n: int) -> list[float]:
    """Two-sided 95% Clopper-Pearson interval, including zero/all successes."""
    return [float(beta.ppf(.025, count, n-count+1)) if count else 0.0,
            float(beta.ppf(.975, count+1, n-count)) if count < n else 1.0]


def single_failure_events(events):
    """Controlled baseline: suppress starts until the accepted repair completes."""
    accepted, busy_until = [], -1.0
    for t, action, cid, kind in sorted(events):
        if action == 1 and t >= busy_until:
            busy_until = t + RATE_MAP[kind]['mttr_hours']
            accepted.extend([(t, 1, cid, kind), (busy_until, 0, cid, kind)])
    return accepted


def evaluate_events(config: Facility, groups: list[dict], events: list[tuple], hours: float, capture=False):
    """Integrate half-open outage intervals; events at the horizon have no impact."""
    tracker = CapacityTracker(config, groups)
    last = down = energy = 0.0
    minimum = surviving = tracker.capacities()[2]
    overlap = False
    samples = []
    for time, action, cid, kind in sorted(events):
        t = min(time, hours)
        dt = max(0.0, t - last)
        lost = max(0, config.it_load_kw - surviving)
        if lost > 0:
            down += dt
        energy += lost * dt
        last = t
        if time >= hours:
            break
        tracker.update(cid, action == 1)
        overlap = overlap or len(tracker.failed) > 1
        surviving = tracker.capacities()[2]
        minimum = min(minimum, surviving)
        if capture and action == 1:
            samples.append({'component': cid, 'kind': kind, 'time_hours': time,
                            'duration_hours': RATE_MAP[kind]['mttr_hours'],
                            'active_failures': len(tracker.failed),
                            'surviving_capacity_kw': surviving,
                            'service_maintained': surviving >= config.it_load_kw})
    if last < hours:
        dt = hours - last
        lost = max(0, config.it_load_kw - surviving)
        if lost > 0:
            down += dt
        energy += lost * dt
    return down, energy, minimum, overlap, samples


def trace_trial(config, groups, events, hours):
    """Exact failure/repair states for interactive replay, without rounded times."""
    tracker = CapacityTracker(config, groups)
    def point(time, action, cid):
        power, cooling, surviving = tracker.capacities()
        return {'time_hours': time, 'action': action, 'component': cid,
                'surviving_capacity_kw': surviving, 'served_it_kw': min(config.it_load_kw, surviving),
                'power_capacity_kw': power, 'cooling_capacity_kw': cooling,
                'failed_components': sorted(tracker.failed),
                'service_maintained': surviving >= config.it_load_kw}
    trace = [point(0.0, 'start', '')]
    for time, action, cid, _ in sorted(events):
        if time >= hours:
            break
        tracker.update(cid, action == 1)
        trace.append(point(time, 'failure' if action == 1 else 'repair', cid))
    trace.append(point(hours, 'end', ''))
    return trace


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
            unit_index = int(c['id'].split('-')[1][1:])
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
            trial_events = single_failure_events(trial_events)
            events[i] = trial_events
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
    lower, upper = exact_probability_interval(outage_trials, n)
    mean_ci = [max(0, mean-1.96*se), min(100, mean+1.96*se)]
    ci_method = 'normal-approximation'
    if not outage_trials:
        # E[downtime/horizon] <= P(any outage). Never report [100,100] certainty.
        mean_ci = [100 * (1-upper), 100.0]
        ci_method = 'conservative-outage-risk-bound'
    evidence = ('insufficient' if outage_trials < 30 else
                'above' if mean_ci[0] >= target else
                'below' if mean_ci[1] < target else 'inconclusive')
    worst = int(np.argmax(downtime))
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
        'availability_percent': mean, 'availability_ci95': mean_ci,
        'availability_ci_method': ci_method, 'evidence_status': evidence,
        'sla_breach_probability_ci95': exact_probability_interval(breach_count, n),
        'annual_sla_budget_minutes': (1-target/100)*525600,
        'p99_annual_downtime_minutes': float(np.quantile(annual_minutes, .99)),
        'worst_trial': {'trial_id': worst+1, 'downtime_minutes': float(downtime[worst]*60),
                        'horizon_hours': hours, 'timeline': trace_trial(config, groups, events[worst], hours)},
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


def paired_comparison(results: list[dict]) -> list[dict]:
    """Use paired trial differences; independent-error bars discard stream coupling."""
    comparisons = []
    for left, right in [(0, 1), (0, 2), (1, 2)]:
        a, b = results[left], results[right]
        delta = np.array([t['annual_downtime_minutes'] for t in a['trial_results']]) - np.array(
            [t['annual_downtime_minutes'] for t in b['trial_results']])
        mean = float(delta.mean())
        half = float(1.96 * delta.std(ddof=1) / math.sqrt(len(delta)))
        comparisons.append({'baseline': a['redundancy'], 'alternative': b['redundancy'],
                            'downtime_reduction_minutes': mean, 'ci95': [mean-half, mean+half],
                            'nonzero_pairs': int(np.count_nonzero(delta)),
                            'evidence_limited': int(np.count_nonzero(delta)) < 30})
    return comparisons
