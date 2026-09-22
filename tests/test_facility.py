"""Rack layout and software-stack model tests."""
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def _default():
    return client.get('/api/software/default').json()


def test_default_layout_evaluates():
    d = _default()
    r = client.post('/api/racks/evaluate', json=d['layout'])
    assert r.status_code == 200
    body = r.json()
    assert body['rack_count'] == 12 and body['online_racks'] == 12
    assert body['total_load_kw'] > 0 and body['lost_load_kw'] == 0


def test_feed_failure_drops_single_fed_rack():
    d = _default()
    layout = d['layout']
    layout['failed_feeds'] = ['A']
    body = client.post('/api/racks/evaluate', json=layout).json()
    single = [r for r in body['racks'] if r['feed'] == 'A']
    assert single and all(not r['online'] for r in single)
    assert body['lost_load_kw'] > 0


def test_overlapping_devices_rejected():
    d = _default()
    rack = d['layout']['racks'][0]
    rack['devices'][1]['u_position'] = rack['devices'][0]['u_position']
    assert client.post('/api/racks/evaluate', json=d['layout']).status_code == 422


def test_duplicate_cell_rejected():
    d = _default()
    d['layout']['racks'][1]['row'] = d['layout']['racks'][0]['row']
    d['layout']['racks'][1]['col'] = d['layout']['racks'][0]['col']
    assert client.post('/api/racks/evaluate', json=d['layout']).status_code == 422


def _model(d, **kw):
    base = {'layout': d['layout'], 'services': d['services'], 'threats': [], 'failed_hosts': [], 'segmentation': True, 'backups_available': True, 'endpoint_protection': False}
    base.update(kw)
    return base


def test_healthy_stack_is_normal():
    d = _default()
    body = client.post('/api/software/evaluate', json=_model(d)).json()
    assert body['state'] == 'NORMAL' and body['services_up'] == body['services_total']


def test_worm_contained_by_segmentation_but_not_without():
    d = _default()
    origin = d['services'][0]['hosts'][0]
    contained = client.post('/api/software/evaluate', json=_model(d, threats=[{'kind': 'worm', 'origin_host': origin, 'hops': 5}])).json()
    open_net = client.post('/api/software/evaluate', json=_model(d, threats=[{'kind': 'worm', 'origin_host': origin, 'hops': 5}], segmentation=False)).json()
    assert len(open_net['infected_hosts']) >= len(contained['infected_hosts'])
    assert origin in contained['infected_hosts']


def test_ransomware_without_backups_takes_down_stateful_services():
    d = _default()
    db_host = next(s for s in d['services'] if s['id'] == 'db')['hosts'][0]
    body = client.post('/api/software/evaluate', json=_model(d, threats=[{'kind': 'ransomware', 'origin_host': db_host, 'hops': 0}], backups_available=False)).json()
    db = next(s for s in body['services'] if s['id'] == 'db')
    assert not db['up'] and 'data loss' in db['reason']
    assert body['estimated_recovery_hours'] == 96


def test_dependency_failure_cascades_to_application():
    d = _default()
    lb_hosts = next(s for s in d['services'] if s['id'] == 'lb')['hosts']
    body = client.post('/api/software/evaluate', json=_model(d, failed_hosts=lb_hosts)).json()
    web = next(s for s in body['services'] if s['id'] == 'web')
    assert not web['up'] and 'dependency down' in web['reason']


def test_unknown_dependency_rejected():
    d = _default()
    d['services'][0]['depends_on'] = ['nope']
    assert client.post('/api/software/evaluate', json=_model(d)).status_code == 422
