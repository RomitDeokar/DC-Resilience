import numpy as np
import pytest
from fastapi.testclient import TestClient
from backend.app import app
from backend.models import Facility, topology, capacity_state
from backend.engine import simulate, evaluate_events, sample_failure_time

client = TestClient(app)

def config(redundancy='N+1', n=200):
    c = Facility()
    c.power.redundancy = c.cooling.redundancy = redundancy
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
    assert len(client.get('/api/failure-rates').json()['rates']) == 5
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
