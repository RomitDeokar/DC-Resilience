import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend.models import Facility, topology, capacity_state
from backend.engine import simulate, evaluate_events, sample_failure_time

client = TestClient(app)

def config(redundancy='N+1', n=200):
    c = Facility()
    c.power.redundancy = c.cooling.redundancy = c.it.redundancy = redundancy
    c.simulation.num_trials = n
    return c

@pytest.mark.parametrize('red', ['N', 'N+1', '2N'])
def test_topologies_cover_identical_load(red):
    c = config(red)
    c.it_load_kw = 10500
    assert capacity_state(c, topology(c), set())['service_maintained']
    assert all(g['required_units'] * g['capacity_kw_each'] >= c.it_load_kw for g in topology(c))

def test_n_plus_one_tolerates_one_not_two():
    c = config()
    g = topology(c)
    assert capacity_state(c, g, {'UPS-A01'})['service_maintained']
    s = capacity_state(c, g, {'UPS-A01', 'UPS-A02'})
    assert not s['service_maintained']
    assert s['surviving_capacity_kw'] == 7500

def test_2n_is_independent_trains_not_pooling():
    c = config('2N')
    g = topology(c)
    assert capacity_state(c, g, {'UPS-A01', 'PDU-A01'})['service_maintained']
    assert not capacity_state(c, g, {'UPS-A01', 'PDU-B01'})['service_maintained']

def test_overlapping_outages_union_and_clipping():
    c = config('N')
    e = [(1,1,'UPS-A01','UPS_MODULE'), (5,0,'UPS-A01','UPS_MODULE'),
         (3,1,'CRAC-A01','CRAC'), (7,0,'CRAC-A01','CRAC')]
    assert evaluate_events(c, topology(c), e, 10)[0] == 6
    assert evaluate_events(c, topology(c), e, 4)[0] == 3

def test_n_plus_one_overlap_causes_outage():
    c = config()
    e = [(1,1,'UPS-A01','UPS_MODULE'), (5,0,'UPS-A01','UPS_MODULE'),
         (3,1,'UPS-A02','UPS_MODULE'), (7,0,'UPS-A02','UPS_MODULE')]
    down, _, _, overlap, _ = evaluate_events(c, topology(c), e, 10)
    assert down == 2 and overlap

def test_reproducible_and_bounded():
    c = config()
    a, b = simulate(c), simulate(c)
    assert a == b
    assert 0 <= a['availability_percent'] <= 100
    assert sum(x['trials'] for x in a['histogram']) == 200
    assert a['expected_annual_downtime_minutes'] == pytest.approx((1-a['availability_percent']/100)*525600, abs=1e-6)

def test_rate_units_and_analytic_single_component():
    rng = np.random.default_rng(1)
    waits = [sample_failure_time('GENERATOR', rng) for _ in range(40000)]
    assert np.mean(waits) == pytest.approx(8760/.58, rel=.025)
    # Renewal reward: lambda is PER YEAR, so expected downtime hours/year is lambda*MTTR,
    # approximately (exact stationary result accounts for time spent under repair).
    hours = 8760
    count = 100000
    times = rng.exponential(8760/.58, count)
    down = np.zeros(count)
    live = np.flatnonzero(times < hours)
    while len(live):
        down[live] += np.minimum(25.74, hours-times[live])
        times[live] += 25.74 + rng.exponential(8760/.58, len(live))
        live = live[times[live] < hours]
    assert np.mean(down) == pytest.approx(.58*25.74, rel=.025)

def test_api_validation_and_injection():
    assert client.get('/api/health').status_code == 200
    rates = client.get('/api/failure-rates').json()['rates']
    assert {r['component'] for r in rates} == {'UPS_MODULE', 'GENERATOR', 'PDU', 'CRAC', 'ATS', 'SERVER', 'OS', 'NETWORK', 'STORAGE', 'APPLICATION'}
    assert all(r['status'] == 'illustrative' for r in rates if r['component'] in {'PDU', 'CRAC', 'SERVER', 'OS', 'NETWORK', 'STORAGE', 'APPLICATION'})
    assert client.post('/api/simulate', json={'it_load_kw': -1}).status_code == 422
    assert client.post('/api/simulate', json={'simulation': {'num_trials': 999999}}).status_code == 422
    assert client.post('/api/inject-failure', json={'config': {}, 'failed_components': ['bogus']}).status_code == 422
    r = client.post('/api/inject-failure', json={'config': {}, 'failed_components': ['UPS-A01','UPS-A02']})
    assert r.json()['lost_capacity_kw'] == 2500

def test_utility_ignores_generator_failure():
    c = config('N')
    c.simulation.operating_mode = 'utility'
    assert capacity_state(c, topology(c), {'GEN-A01', 'GEN-A02'})['service_maintained']

def test_comparison_and_nonoverlap_baseline():
    c = config(n=100)
    c.simulation.failure_mode = 'single'
    c.simulation.stress_multiplier = 20
    r = client.post('/api/compare', json=c.model_dump())
    assert r.status_code == 200
    results = r.json()['results']
    assert [x['redundancy'] for x in results] == ['N','N+1','2N']
    assert results[0]['infra_cost_index'] == 1
    assert results[2]['infra_cost_index'] == 2
    assert results[1]['expected_annual_downtime_minutes'] == 0
    assert all(x['overlap_trials'] == 0 for x in results)


def test_horizon_events_do_not_create_phantom_outage():
    c = config('N')
    result = evaluate_events(c, topology(c), [(10, 1, 'UPS-A01', 'UPS_MODULE')], 10)
    assert result[0] == 0
    assert result[2] == 10000


def test_same_time_repair_precedes_failure():
    c = config()
    e = [(1, 1, 'UPS-A01', 'UPS_MODULE'), (3, 0, 'UPS-A01', 'UPS_MODULE'),
         (3, 1, 'UPS-A02', 'UPS_MODULE'), (5, 0, 'UPS-A02', 'UPS_MODULE')]
    result = evaluate_events(c, topology(c), e, 10)
    assert result[0] == 0
    assert not result[3]


def test_unserved_energy_integral():
    c = config('N')
    e = [(1, 1, 'UPS-A01', 'UPS_MODULE'), (5, 0, 'UPS-A01', 'UPS_MODULE')]
    down, energy, *_ = evaluate_events(c, topology(c), e, 10)
    assert down == 4
    assert energy == 10000


def test_worst_trial_replay_matches_integrated_result():
    c = config('N', n=100)
    r = simulate(c)
    w = r['worst_trial']
    trace = w['timeline']
    hours = sum(b['time_hours']-a['time_hours'] for a, b in zip(trace, trace[1:])
                if not a['service_maintained'])
    assert hours*60 == pytest.approx(w['downtime_minutes'])
    assert w['downtime_minutes'] == max(t['annual_downtime_minutes'] for t in r['trial_results'])
    assert trace[0]['action'] == 'start' and trace[-1]['action'] == 'end'
    for point in trace:
        expected = capacity_state(c, topology(c), set(point['failed_components']))
        assert point['surviving_capacity_kw'] == expected['surviving_capacity_kw']


def test_zero_outages_never_produce_perfect_certainty():
    c = config()
    c.simulation.failure_mode = 'single'
    r = simulate(c)
    assert r['availability_percent'] == 100
    assert r['availability_ci95'][0] < 100
    assert r['availability_ci_method'] == 'conservative-outage-risk-bound'
    assert r['evidence_status'] == 'insufficient'
    assert r['sla_breach_probability_ci95'][1] > 0


def test_paired_comparison_and_horizon_metadata():
    c = config(n=100)
    c.simulation.simulated_years_per_trial = 2
    r = client.post('/api/compare', json=c.model_dump()).json()
    assert len(r['paired_comparisons']) == 3
    for pair in r['paired_comparisons']:
        results = {s['redundancy']: s for s in r['results']}
        delta = (results[pair['baseline']]['expected_annual_downtime_minutes'] -
                 results[pair['alternative']]['expected_annual_downtime_minutes'])
        assert pair['downtime_reduction_minutes'] == pytest.approx(delta)
        assert pair['ci95'][0] <= delta <= pair['ci95'][1]
    for result in r['results']:
        assert result['worst_trial']['horizon_hours'] == 17520
        assert result['annual_sla_budget_minutes'] == pytest.approx(94.608)


def test_injection_duration_energy_duplicates_and_whitespace():
    r = client.post('/api/inject-failure', json={'config': {},
        'failed_components': ['UPS-A01', 'UPS-A02', 'UPS-A02'], 'duration_hours': 2}).json()
    assert r['downtime_minutes'] == 120 and r['unserved_energy_kwh'] == 5000
    assert len(r['failed_components']) == 2
    assert client.post('/api/topology', json={'facility_name': '   '}).status_code == 422


@pytest.mark.parametrize('power,cooling', [('2N','N'), ('N','2N'), ('N+1','2N')])
def test_mixed_architectures_have_correct_independent_capacity(power, cooling):
    c = config(power)
    c.cooling.redundancy = cooling
    state = capacity_state(c, topology(c), {'UPS-A01'})
    assert state['service_maintained'] == (power != 'N')


def test_api_concurrency_limit_releases_slots():
    from backend.app import slots
    slots.acquire(); slots.acquire()
    try:
        assert client.post('/api/simulate', json=config(n=100).model_dump()).status_code == 429
        assert client.get('/api/health').status_code == 200
    finally:
        slots.release(); slots.release()
    assert client.post('/api/simulate', json=config(n=100).model_dump()).status_code == 200


@pytest.mark.parametrize('red', ['N', 'N+1', '2N'])
def test_it_server_and_service_failures(red):
    c = config(red)
    g = topology(c)
    assert capacity_state(c, g, {'SRV-A01'})['service_maintained'] == (red != 'N')
    if red == 'N+1':
        assert not capacity_state(c, g, {'SRV-A01', 'SRV-A02'})['service_maintained']
    if red == '2N':
        assert not capacity_state(c, g, {'SRV-A01', 'NET-B01'})['service_maintained']
    assert not capacity_state(c, g, {u['id'] for group in g if group['kind'] == 'APPLICATION' for u in group['components']})['service_maintained']


def test_fractional_servers_never_have_negative_capacity():
    from backend.models import CapacityTracker
    c = config('N')
    c.it.server_nodes_required = 7
    g = topology(c)
    tracker = CapacityTracker(c, g)
    servers = [u['id'] for group in g if group['kind'] == 'SERVER' for u in group['components']]
    for _ in range(100):
        for cid in servers:
            tracker.update(cid, True)
        assert tracker.it_capacity() == 0
        for cid in servers:
            tracker.update(cid, False)
        assert tracker.capacities()[2] == c.it_load_kw


def test_overlapping_hardware_and_software_require_both_repairs():
    c = config('N')
    e = [(1, 1, 'SRV-A01', 'SERVER'), (5, 0, 'SRV-A01', 'SERVER'),
         (3, 1, 'SRV-A01', 'OS'), (7, 0, 'SRV-A01', 'OS')]
    assert evaluate_events(c, topology(c), e, 10)[0] == 6


def test_maintenance_and_dependency_modes_are_validated():
    assert client.post('/api/preflight', json={'simulation': {'failure_mode': 'single', 'dependent_failures': True}}).status_code == 422
    assert client.post('/api/preflight', json={'maintenance': {'enabled': True, 'component_id': 'UPS-A99'}}).status_code == 422
    assert client.post('/api/preflight', json={'maintenance': {'enabled': True, 'start_hour': 8759, 'duration_hours': 4}}).status_code == 422
    response = client.post('/api/preflight', json={'simulation': {'num_trials': 20000, 'stress_multiplier': 20, 'simulated_years_per_trial': 5}})
    assert response.status_code == 422 and '45M' in response.text
    assert client.post('/api/preflight', json={'simulation': {'num_trials': 1000, 'stress_multiplier': 20}}).status_code == 200


def test_common_cause_counts_incidents_not_just_units():
    c = config('2N', n=100)
    c.simulation.dependent_failures = True
    c.simulation.common_cause_probability = 1
    c.simulation.common_cause_events_per_year = 3
    c.simulation.common_cause_scope = 'site'
    r = simulate(c)
    assert r['scenario_incidents']['COMMON_CAUSE'] > 0
    units = sum(len(g['components']) for g in topology(c) if g['kind'] in {'UPS_MODULE', 'GENERATOR'})
    assert r['scenario_events']['COMMON_CAUSE'] == units*r['scenario_incidents']['COMMON_CAUSE']
    assert r['outage_trials'] > 0


def test_maintenance_peer_skips_are_explicit():
    c = config('N', n=100)
    c.maintenance.enabled = c.maintenance.inject_failure = True
    c.maintenance.component_id = 'ATS-A01'
    r = simulate(c)
    assert r['maintenance']['forced_fault_skipped_trials'] == 100
    assert r['maintenance']['forced_fault_applied_trials'] == 0
    assert not r['maintenance']['maintenance_only_maintained']
    c.power.redundancy = 'N+1'
    r = simulate(c)
    assert r['maintenance']['forced_fault_applied_trials'] == 100
    assert r['maintenance']['forced_fault_skipped_trials'] == 0
    assert r['maintenance']['maintenance_only_maintained']


def test_trial_prefix_and_renewal_stream_pairing():
    from backend.engine import event_batches
    c = config('N', n=100)
    c.simulation.stress_multiplier = 20
    low = list(event_batches(c, topology(c), {'OS': .5}))
    high = list(event_batches(c, topology(c), {'OS': 1.5}))
    c.simulation.num_trials = 300
    assert low == list(event_batches(c, topology(c), {'OS': .5}))[:100]
    for (_, a), (_, b) in zip(low, high):
        la = sorted(t for t, action, cid, kind in a if action == 1 and kind == 'OS' and cid == 'SRV-A01')
        hb = sorted(t for t, action, cid, kind in b if action == 1 and kind == 'OS' and cid == 'SRV-A01')
        assert len(hb) >= len(la)
        for ordinal, (x, y) in enumerate(zip(la, hb)):
            assert x-ordinal == pytest.approx(3*(y-ordinal))


def test_maintenance_randomness_independent_of_surge_toggle():
    from backend.engine import event_batches
    c = config(n=100)
    c.maintenance.enabled = c.maintenance.inject_failure = True
    a = list(event_batches(c, topology(c)))
    c.simulation.dependent_failures = True
    b = list(event_batches(c, topology(c)))
    for (_, x), (_, y) in zip(a, b):
        assert [e for e in x if e[3] == 'FORCED_FAILURE'] == [e for e in y if e[3] == 'FORCED_FAILURE']


def test_generator_audit_and_inactive_effective_rates():
    from backend.engine import rate_value
    c = config(n=100)
    c.simulation.generator_rate_basis = 'count_exposure'
    assert rate_value(c, 'GENERATOR', {}) == pytest.approx(115/266)
    c.simulation.operating_mode = 'utility'
    c.it.enabled = False
    r = simulate(c)
    assert all(r['effective_rates'][k] == 0 for k in ['GENERATOR', 'SERVER', 'OS', 'NETWORK', 'STORAGE', 'APPLICATION'])


def test_diagnostic_reruns_are_reproducible_and_do_not_mutate_config():
    from backend.engine import diagnostics
    c = config('N', n=100)
    before = c.model_dump()
    a = diagnostics(c)
    assert c.model_dump() == before
    assert a == diagnostics(c)
    assert len(a['sensitivity']) == 10
    assert a['generator_audit']['alternative_basis'] == 'count_exposure'
    assert a['trials'] == 100


def test_slots_release_after_engine_error(monkeypatch):
    import importlib
    module = importlib.import_module('backend.app')
    def fail(_):
        raise RuntimeError('test error')
    monkeypatch.setattr(module, 'simulate', fail)
    with pytest.raises(RuntimeError, match='test error'):
        module.experiment(config(n=100), False)
    assert module.slots.acquire(blocking=False)
    assert module.slots.acquire(blocking=False)
    module.slots.release(); module.slots.release()
