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
DATASET_VERSION = '2026-09-12-audited-assumptions-v2'
ENGINE_VERSION = '2.3.0'
MODEL_NOTES = [
    'Mixed dataset: 3 IEEE-493-citing secondary-source records and 7 explicitly illustrative PDU/CRAC/IT records. Not publication-ready field evidence.',
    'Source audit: Wiboonrat (2020) Table 2 has no PDU or CRAC rates. Generator row prints 0.58/year, but 115/266 gives 0.432330827/year. Neither interpretation is independently verified.',
    'Independent exponential operating lifetimes, constant MTTR, perfect repair, all components healthy at t=0; exact event integration in fixed 256-trial batches bounds memory.',
    'Islanded mode continuously requires generators. Utility mode assumes an ideal grid and ignores generators. Failure-to-start is NOT an operating hazard: per-demand start/retry, grid outages, battery discharge and fuel exhaustion remain future work.',
    '2N has complete independent A/B power, cooling and IT service trains without cross-ties. Perfect workload failover and matching service placement within each IT train are assumed.',
    'IT models representative server nodes (hardware plus co-located OS/hypervisor), network, storage and application replicas. IT capacities are workload-equivalent kW, NOT individual server electrical draw. No disk durability, quorum, VM placement, packet routing, human-error or cybersecurity model.',
    'Optional common cause: Poisson opportunities thinned by a user probability; target power (all UPS/generator units) or application (shared bad deployment on all application replicas), in bank A or across the site. One opportunity stream and configured recovery duration; not both targets at once. This adds hazards, not a fixed-marginal correlation coefficient. Parameters are assumptions; arXiv:2402.18187 motivates dependence, not these mechanisms or rates.',
    'Optional maintenance: one scheduled window per full trial. A forced companion fault, if enabled, is a conditional stress test, NOT an empirical annual failure forecast. Maintenance-only tolerance and maintenance-plus-fault tolerance are different; neither certifies Tier III/IV.',
    'No switching delays, thermal inertia or physical power-to-rack mappings. Overlapping causes on the same unit are reference-counted until ALL causes clear.',
    'Historical Tier-associated percentages are illustrative SLA benchmarks, not Uptime Institute Tier certification criteria.',
    'INR budgets are editable educational planning assumptions, NOT researched market prices or quotes. Exclude installation, tax, land, staffing, fuel, software licensing and OPEX; representative IT count is not a procurement BOM.',
    '95% normal mean intervals are approximate; fewer than 30 outage trials warns of sparse evidence. Zero-outage intervals use a conservative exact trial-risk bound, never certainty. These intervals exclude input/model uncertainty.',
    'Year-labelled downtime is annualized; SLA breach probability is over the full trial horizon. Worst trial replay is selected, not representative.',
    'Scenario event counts count affected units; scenario incidents count distinct shared-event starts. A forced maintenance fault is skipped when no same-group peer exists, and skipped trials are reported.',
    'Random draws are coupled by component, trial and renewal ordinal for rate sensitivity reruns. Changing engine version can change seeded numerical results.',
    'Progress counts completed trial evaluations, including all diagnostic reruns; it is not an estimate of remaining wall-clock time.',
    'Optional diagnostics use at most 1000 paired trials, independent mode, no maintenance: actual one-factor +/-50% rate reruns and a separate dependency comparison. Sparse paired intervals and rankings are exploratory, not guaranteed.'
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
    active_causes = Counter()
    durations = event_durations(events) if capture else {}
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
        active_causes[cid] += 1 if action == 1 else -1
        tracker.update(cid, active_causes[cid] > 0)
        overlap = overlap or len(tracker.failed) > 1
        surviving = tracker.capacities()[2]
        minimum = min(minimum, surviving)
        if capture and action == 1:
            samples.append({'component': cid, 'kind': kind, 'time_hours': time,
                            'duration_hours': durations.get((time, cid, kind), 0),
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
    active_causes = Counter()
    def point(time, action, cid):
        power, cooling, surviving = tracker.capacities()
        return {'time_hours': time, 'action': action, 'component': cid,
                'surviving_capacity_kw': surviving, 'served_it_kw': min(config.it_load_kw, surviving),
                'power_capacity_kw': power, 'cooling_capacity_kw': cooling, 'it_capacity_kw': tracker.it_capacity(),
                'failed_components': sorted(tracker.failed),
                'service_maintained': surviving >= config.it_load_kw}
    trace = [point(0.0, 'start', '')]
    for time, action, cid, kind in sorted(events):
        if time >= hours:
            break
        active_causes[cid] += 1 if action == 1 else -1
        tracker.update(cid, active_causes[cid] > 0)
        trace.append({**point(time, 'failure' if action == 1 else 'repair', cid), 'cause': kind})
    trace.append(point(hours, 'end', ''))
    return trace


def event_durations(events):
    """Match cause-specific start/end events for honest sample durations."""
    starts, durations = {}, {}
    for t, action, cid, kind in sorted(events):
        key = (cid, kind)
        if action:
            starts.setdefault(key, []).append(t)
        elif starts.get(key):
            start = starts[key].pop(0)
            durations[(start, cid, kind)] = t-start
    return durations


def rate_value(config, kind, factors):
    value = RATE_MAP[kind]['failure_rate_per_year']
    if kind == 'GENERATOR' and config.simulation.generator_rate_basis == 'count_exposure':
        value = 115 / 266
    return value * factors.get(kind, 1)


def event_batches(config, groups, rate_factors=None):
    """Stable source/bank/unit/batch streams; prefix trials reproducible as n grows."""
    sim, factors = config.simulation, rate_factors or {}
    hours = sim.simulated_years_per_trial * 8760
    for offset in range(0, sim.num_trials, 256):
        # Always draw a full batch, including at the final partial batch.
        batch = [[] for _ in range(256)]
        for group in groups:
            kinds = [group['kind']] + (['OS'] if group['kind'] == 'SERVER' else [])
            for kind in kinds:
                if sim.operating_mode == 'utility' and kind == 'GENERATOR':
                    continue
                rate = RATE_MAP[kind]
                annual = rate_value(config, kind, factors) * sim.stress_multiplier
                if annual <= 0:
                    continue
                for c in group['components']:
                    bank = 0 if c['bank'] == 'A' else 1
                    unit = int(c['id'].split('-')[1][1:])
                    rng = np.random.default_rng(np.random.SeedSequence([sim.seed, list(RATE_MAP).index(kind), bank, unit, offset]))
                    times = rng.exponential(8760 / annual, 256)
                    active = np.flatnonzero(times < hours)
                    while active.size:
                        for trial in active:
                            t = float(times[trial])
                            batch[trial].extend([(t, 1, c['id'], kind), (t + rate['mttr_hours'], 0, c['id'], kind)])
                        # Fixed draw positions couple the same trial AND renewal
                        # ordinal across rate reruns, even when active masks differ.
                        waits = rng.exponential(8760 / annual, 256)
                        times[active] += rate['mttr_hours'] + waits[active]
                        active = active[times[active] < hours]
        for j, events in enumerate(batch[:min(256, sim.num_trials-offset)]):
            rng = np.random.default_rng(np.random.SeedSequence([sim.seed, 900, offset+j]))
            if sim.dependent_failures:
                rate = sim.common_cause_events_per_year * sim.common_cause_probability
                kinds = {'APPLICATION'} if sim.common_cause_target == 'application' else {'UPS_MODULE', 'GENERATOR'}
                affected = [c for g in groups if g['kind'] in kinds
                            for c in g['components'] if sim.common_cause_scope == 'site' or c['bank'] == 'A']
                t = float(rng.exponential(8760/rate)) if rate else hours
                while t < hours:
                    for c in affected:
                        events.extend([(t, 1, c['id'], 'COMMON_CAUSE'),
                                       (t+sim.common_cause_duration_hours, 0, c['id'], 'COMMON_CAUSE')])
                    t += float(rng.exponential(8760/rate))
            m = config.maintenance
            if m.enabled:
                # Maintenance draws must not shift when dependency is toggled.
                rng = np.random.default_rng(np.random.SeedSequence([sim.seed, 901, offset+j]))
                events.extend([(m.start_hour, 1, m.component_id, 'MAINTENANCE'),
                               (m.start_hour+m.duration_hours, 0, m.component_id, 'MAINTENANCE')])
                if m.inject_failure:
                    peers = [c for g in groups for c in g['components']
                             if c['id'].split('-')[0] == m.component_id.split('-')[0] and c['id'] != m.component_id]
                    if peers:
                        c = peers[int(rng.integers(len(peers)))]
                        t = float(rng.uniform(m.start_hour, m.start_hour+m.duration_hours))
                        events.extend([(t, 1, c['id'], 'FORCED_FAILURE'),
                                       (t+RATE_MAP[c['kind']]['mttr_hours'], 0, c['id'], 'FORCED_FAILURE')])
            yield offset+j, single_failure_events(events) if sim.failure_mode == 'single' else events


def budget_estimate(config, groups):
    b = config.budget
    per_kw = {'UPS_MODULE': b.ups_inr_per_kw, 'GENERATOR': b.generator_inr_per_kw,
              'PDU': b.pdu_inr_per_kw, 'ATS': b.ats_inr_per_kw, 'CRAC': b.crac_inr_per_kw}
    per_unit = {'SERVER': b.server_node_inr, 'NETWORK': b.network_replica_inr,
                'STORAGE': b.storage_replica_inr, 'APPLICATION': 0}
    rows = [{'kind': g['kind'], 'units': len(g['components']),
             'unit_inr': per_kw[g['kind']] * g['capacity_kw_each'] if g['kind'] in per_kw else per_unit[g['kind']]}
            for g in groups]
    for row in rows:
        row['subtotal_inr'] = row['units'] * row['unit_inr']
    return {'total_inr': sum(r['subtotal_inr'] for r in rows), 'breakdown': rows,
            'basis': 'Editable planning assumptions; not vendor quotes. Tax, installation, OPEX and software licensing excluded.'}


def simulate(config: Facility, rate_factors=None, progress=None) -> dict:
    groups = topology(config)
    sim = config.simulation
    n = sim.num_trials
    hours = sim.simulated_years_per_trial * 8760
    failures = Counter()
    components = [c for group in groups for c in group['components']]
    downtime, unserved, maintenance_down = np.zeros(n), np.zeros(n), np.zeros(n)
    minima = np.full(n, config.it_load_kw)
    overlaps, worst_index, worst_events, worst_down = 0, 0, [], -1
    scenario_counts = Counter()
    scenario_incidents = Counter()
    forced_fault_trials = 0
    sample_events = []
    for i, trial_events in event_batches(config, groups, rate_factors):
        incidents = {(t, kind) for t, action, _, kind in trial_events if action == 1 and kind not in RATE_MAP}
        scenario_incidents.update(kind for _, kind in incidents)
        forced_fault_trials += int(any(kind == 'FORCED_FAILURE' for _, kind in incidents))
        for _, action, _, kind in trial_events:
            if action == 1:
                if kind in RATE_MAP:
                    failures[kind] += 1
                else:
                    scenario_counts[kind] += 1
        down, energy, minimum, overlap, samples = evaluate_events(config, groups, trial_events, hours, len(sample_events) < 60)
        downtime[i], unserved[i], minima[i] = down, energy, minimum
        overlaps += int(overlap)
        if down > worst_down:
            worst_index, worst_events, worst_down = i, trial_events, down
        if config.maintenance.enabled:
            m = config.maintenance
            before = evaluate_events(config, groups, trial_events, m.start_hour)[0]
            through = evaluate_events(config, groups, trial_events, m.start_hour+m.duration_hours)[0]
            maintenance_down[i] = max(0, through-before)
        sample_events.extend([{**s, 'trial_id': i+1} for s in samples][:max(0, 60-len(sample_events))])
        if progress and ((i + 1) % 256 == 0 or i + 1 == n):
            progress((i % 256) + 1)
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
    worst = worst_index
    cumulative = np.cumsum(availability)
    cumulative_square = np.cumsum((availability-100)**2)
    cumulative_loss = np.cumsum(availability-100)
    convergence = []
    for k in np.unique(np.linspace(max(2, n//50), n, 50).astype(int)):
        avg = float(cumulative[k-1]/k)
        variance = max(0, (cumulative_square[k-1]-cumulative_loss[k-1]**2/k)/(k-1))
        half = 1.96*math.sqrt(variance/k)
        zero = not np.any(downtime[:k])
        low = 100*(1-exact_probability_interval(0, int(k))[1]) if zero else max(0, avg-half)
        convergence.append({'trials': int(k), 'availability': avg, 'ci_low': low,
                            'ci_high': min(100, avg+half), 'outage_trials': int(np.count_nonzero(downtime[:k]))})
    bins = [0, 1, 15, 60, 240, 1440, float('inf')]
    histogram = [{'range': 'No outage', 'trials': int(np.sum(annual_minutes == 0))}]
    labels = ['> 0–1 min', '> 1–15 min', '> 15–60 min', '> 1–4 hrs', '> 4–24 hrs', '> 24 hrs']
    for j, label in enumerate(labels):
        histogram.append({'range': label, 'trials': int(np.sum((annual_minutes > bins[j]) & (annual_minutes <= bins[j+1])))})
    base = config.model_copy(deep=True)
    base.power.redundancy = base.cooling.redundancy = base.it.redundancy = 'N'
    base_count = sum(len(g['components']) for g in topology(base))
    topology_name = config.power.redundancy if config.power.redundancy == config.cooling.redundancy else f'{config.power.redundancy} / {config.cooling.redundancy}'
    if config.it.enabled and config.it.redundancy != config.power.redundancy:
        topology_name += f' / IT {config.it.redundancy}'
    maintenance = None
    if config.maintenance.enabled:
        m = config.maintenance
        maintenance = {'component': m.component_id, 'window_hours': m.duration_hours,
                       'maintenance_only_maintained': capacity_state(config, groups, {m.component_id})['service_maintained'],
                       'forced_fault': m.inject_failure, 'forced_fault_applied_trials': forced_fault_trials,
                       'forced_fault_skipped_trials': n-forced_fault_trials if m.inject_failure else 0,
                       'window_outage_trials': int(np.count_nonzero(maintenance_down)),
                       'mean_window_downtime_minutes': float(np.mean(maintenance_down)*60),
                       'window_outage_probability_ci95': exact_probability_interval(int(np.count_nonzero(maintenance_down)), n)}
    return {
        'scenario_events': dict(scenario_counts), 'scenario_incidents': dict(scenario_incidents), 'maintenance': maintenance,
        'budget': budget_estimate(config, groups),
        'effective_rates': {kind: rate_value(config, kind, rate_factors or {})
                            if (kind in {g['kind'] for g in groups} or (kind == 'OS' and config.it.enabled))
                            and not (kind == 'GENERATOR' and sim.operating_mode == 'utility') else 0.0
                            for kind in RATE_MAP},
        'redundancy': topology_name, 'trials_run': n, 'seed': sim.seed,
        'simulated_years': n * sim.simulated_years_per_trial,
        'availability_percent': mean, 'availability_ci95': mean_ci,
        'availability_ci_method': ci_method, 'evidence_status': evidence,
        'annual_downtime_ci95': [(100-mean_ci[1])*5256, (100-mean_ci[0])*5256],
        'availability_standard_error_pp': se,
        'sla_breach_probability_ci95': exact_probability_interval(breach_count, n),
        'annual_sla_budget_minutes': (1-target/100)*525600,
        'p99_annual_downtime_minutes': float(np.quantile(annual_minutes, .99)),
        'worst_trial': {'trial_id': worst+1, 'downtime_minutes': float(downtime[worst]*60),
                        'horizon_hours': hours, 'timeline': trace_trial(config, groups, worst_events, hours)},
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


def paired_delta(a, b):
    delta = np.array([t['annual_downtime_minutes'] for t in b['trial_results']]) - np.array(
        [t['annual_downtime_minutes'] for t in a['trial_results']])
    mean = float(delta.mean())
    half = 1.96 * float(delta.std(ddof=1)) / math.sqrt(len(delta))
    return {'delta_minutes': mean, 'ci95': [mean-half, mean+half],
            'nonzero_pairs': int(np.count_nonzero(delta)), 'evidence_limited': int(np.count_nonzero(delta)) < 30}


def diagnostics(config, progress=None):
    """Real one-factor reruns, never failure-count proxies. Small fixed paired study."""
    c = config.model_copy(deep=True)
    c.simulation.num_trials = min(1000, c.simulation.num_trials)
    c.simulation.diagnostics = c.simulation.dependent_failures = c.maintenance.enabled = False
    c.simulation.failure_mode = 'overlapping'
    # A stored, inactive software scenario must not become a no-op dependency
    # experiment when the user disables IT before requesting diagnostics.
    if not c.it.enabled:
        c.simulation.common_cause_target = 'power'
    def run(label, factors=None):
        callback = (lambda completed: progress(label, completed)) if progress else None
        if progress:
            progress(label, 0)
        return simulate(c, factors, progress=callback)

    baseline = run('Sensitivity baseline')
    rows = []
    active = {g['kind'] for g in topology(c)} | ({'OS'} if c.it.enabled else set())
    for kind in RATE_MAP:
        if kind not in active or (kind == 'GENERATOR' and c.simulation.operating_mode == 'utility'):
            continue
        low, high = run(f'{kind}: rate -50%', {kind: .5}), run(f'{kind}: rate +50%', {kind: 1.5})
        rows.append({'kind': kind, 'label': RATE_MAP[kind]['label'],
                     'low': paired_delta(baseline, low), 'high': paired_delta(baseline, high)})
    rows.sort(key=lambda r: max(abs(r['low']['delta_minutes']), abs(r['high']['delta_minutes'])), reverse=True)
    c.simulation.dependent_failures = True
    dependent = run('Shared-hazard comparison')
    generator_audit = None
    if c.simulation.operating_mode == 'islanded':
        c.simulation.dependent_failures = False
        c.simulation.generator_rate_basis = 'count_exposure' if config.simulation.generator_rate_basis == 'published' else 'published'
        alternative = run('Generator source audit')
        generator_audit = {'alternative_basis': c.simulation.generator_rate_basis, **paired_delta(baseline, alternative)}
    return {'trials': c.simulation.num_trials, 'common_cause_target': c.simulation.common_cause_target, 'sensitivity': rows,
            'baseline_downtime_minutes': baseline['expected_annual_downtime_minutes'],
            'dependent_downtime_minutes': dependent['expected_annual_downtime_minutes'],
            'dependency_effect': paired_delta(baseline, dependent), 'generator_audit': generator_audit,
            'basis': 'Paired +/-50% operating-rate reruns; same selected architecture, stress and seed; no maintenance. Positive delta means increased downtime.'}
