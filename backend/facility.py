"""Rack floor-plan layout and software-stack / cyber-threat models.

Deterministic, stateless evaluation. Racks are user-placed on a row/column grid; each rack holds
servers in U-slots. Software services run as replicas on servers; threats (virus, worm, ransomware)
spread across network segments unless contained. No probabilistic claims are made here.
"""
from __future__ import annotations
from collections import deque
from typing import Literal
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, model_validator

router = APIRouter(prefix='/api', tags=['facility'])


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, str_strip_whitespace=True)


# ----------------------------------------------------------------------------- racks
DeviceKind = Literal['compute', 'storage', 'network', 'ups', 'blank']


class Device(Strict):
    id: str = Field(min_length=1, max_length=32)
    name: str = Field('Server', min_length=1, max_length=60)
    kind: DeviceKind = 'compute'
    u_position: int = Field(1, ge=1, le=52)
    height_u: int = Field(2, ge=1, le=20)
    power_kw: float = Field(0.5, ge=0, le=60)
    os: str = Field('Linux', max_length=40)
    segment: str = Field('prod', min_length=1, max_length=24)
    patched: bool = True


class Rack(Strict):
    id: str = Field(min_length=1, max_length=32)
    name: str = Field('Rack', min_length=1, max_length=60)
    row: int = Field(0, ge=0, le=40)
    col: int = Field(0, ge=0, le=60)
    height_u: int = Field(42, ge=10, le=52)
    max_power_kw: float = Field(12, gt=0, le=100)
    feed: Literal['A', 'B', 'AB'] = 'AB'
    cooling_zone: str = Field('Zone 1', min_length=1, max_length=24)
    devices: list[Device] = Field(default_factory=list, max_length=60)


class Layout(Strict):
    name: str = Field('Data hall 1', min_length=1, max_length=80)
    rows: int = Field(4, ge=1, le=40)
    cols: int = Field(8, ge=1, le=60)
    racks: list[Rack] = Field(default_factory=list, max_length=400)
    failed_feeds: list[Literal['A', 'B']] = Field(default_factory=list, max_length=2)
    failed_zones: list[str] = Field(default_factory=list, max_length=40)
    failed_racks: list[str] = Field(default_factory=list, max_length=400)

    @model_validator(mode='after')
    def check(self):
        ids = [r.id for r in self.racks]
        if len(ids) != len(set(ids)):
            raise ValueError('Rack ids must be unique.')
        cells = {(r.row, r.col) for r in self.racks}
        if len(cells) != len(self.racks):
            raise ValueError('Two racks cannot occupy the same floor cell.')
        for r in self.racks:
            if r.row >= self.rows or r.col >= self.cols:
                raise ValueError(f'Rack {r.id} is outside the {self.rows}x{self.cols} floor grid.')
            dev_ids = [d.id for d in r.devices]
            if len(dev_ids) != len(set(dev_ids)):
                raise ValueError(f'Device ids in rack {r.id} must be unique.')
            occupied: set[int] = set()
            for d in r.devices:
                slots = set(range(d.u_position, d.u_position + d.height_u))
                if max(slots) > r.height_u:
                    raise ValueError(f'{d.id} extends beyond the top of rack {r.id}.')
                if slots & occupied:
                    raise ValueError(f'{d.id} overlaps another device in rack {r.id}.')
                occupied |= slots
        return self


def rack_online(rack: Rack, layout: Layout) -> bool:
    if rack.id in layout.failed_racks or rack.cooling_zone in layout.failed_zones:
        return False
    feeds = set(rack.feed)  # 'AB' -> {'A','B'}
    return bool(feeds - set(layout.failed_feeds))


def evaluate_layout(layout: Layout) -> dict:
    racks = []
    total_kw = total_cap = 0.0
    zones: dict[str, dict] = {}
    warnings: list[str] = []
    for r in layout.racks:
        load = sum(d.power_kw for d in r.devices)
        used = sum(d.height_u for d in r.devices)
        online = rack_online(r, layout)
        util = load / r.max_power_kw * 100
        if util > 100:
            warnings.append(f'{r.name} ({r.id}) draws {load:.1f} kW against a {r.max_power_kw:.0f} kW limit.')
        if r.feed != 'AB':
            warnings.append(f'{r.name} ({r.id}) is single-fed from feed {r.feed}: a feed outage takes it offline.')
        racks.append({'id': r.id, 'name': r.name, 'row': r.row, 'col': r.col, 'feed': r.feed, 'cooling_zone': r.cooling_zone,
                      'load_kw': round(load, 3), 'max_power_kw': r.max_power_kw, 'utilization_percent': round(util, 1),
                      'used_u': used, 'height_u': r.height_u, 'free_u': r.height_u - used, 'devices': len(r.devices),
                      'online': online, 'status': 'failed' if not online else 'overloaded' if util > 100 else 'hot' if util > 85 else 'normal'})
        total_kw += load
        total_cap += r.max_power_kw
        z = zones.setdefault(r.cooling_zone, {'zone': r.cooling_zone, 'racks': 0, 'load_kw': 0.0, 'online': r.cooling_zone not in layout.failed_zones})
        z['racks'] += 1
        z['load_kw'] = round(z['load_kw'] + load, 3)
    online_kw = sum(x['load_kw'] for x in racks if x['online'])
    return {'name': layout.name, 'rows': layout.rows, 'cols': layout.cols, 'racks': racks, 'zones': list(zones.values()),
            'total_load_kw': round(total_kw, 3), 'online_load_kw': round(online_kw, 3), 'lost_load_kw': round(total_kw - online_kw, 3),
            'installed_capacity_kw': round(total_cap, 3), 'rack_count': len(racks), 'online_racks': sum(1 for x in racks if x['online']),
            'device_count': sum(len(r.devices) for r in layout.racks),
            'average_density_kw': round(total_kw / len(racks), 2) if racks else 0, 'warnings': warnings,
            'note': 'Design-intent placement model. Power and U-space are checked per rack; airflow, weight and cabling are not modelled.'}


@router.post('/racks/evaluate')
def racks_evaluate(layout: Layout):
    return evaluate_layout(layout)


# -------------------------------------------------------------------------- software
ServiceTier = Literal['hypervisor', 'operating_system', 'database', 'message_queue', 'application', 'load_balancer', 'orchestration', 'identity', 'monitoring', 'backup']
ThreatKind = Literal['virus', 'worm', 'ransomware', 'misconfiguration', 'bad_patch']

# Assumed recovery effort (hours) per threat. Editable planning assumptions, not measured data.
THREAT_RECOVERY_HOURS = {'virus': 6, 'worm': 12, 'ransomware': 48, 'misconfiguration': 2, 'bad_patch': 3}
THREAT_TEXT = {
    'virus': 'Executes on the origin host and reaches reachable unpatched hosts in the same segment each hop.',
    'worm': 'Self-propagating: crosses segments unless segmentation is enforced; patched hosts are immune.',
    'ransomware': 'Encrypts local and reachable data. Storage-backed services are lost until restored from backup.',
    'misconfiguration': 'A pushed configuration change breaks the origin host and hosts sharing its role. No spread.',
    'bad_patch': 'A faulty update rolls out to every host in the same segment that is marked patched.',
}


class Service(Strict):
    id: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=60)
    tier: ServiceTier = 'application'
    hosts: list[str] = Field(default_factory=list, max_length=200)
    min_replicas: int = Field(1, ge=1, le=200)
    depends_on: list[str] = Field(default_factory=list, max_length=50)
    stateful: bool = False


class Threat(Strict):
    kind: ThreatKind = 'virus'
    origin_host: str = Field(min_length=1, max_length=32)
    hops: int = Field(2, ge=0, le=20)


class SoftwareModel(Strict):
    layout: Layout
    services: list[Service] = Field(default_factory=list, max_length=100)
    threats: list[Threat] = Field(default_factory=list, max_length=10)
    failed_hosts: list[str] = Field(default_factory=list, max_length=400)
    segmentation: bool = True
    backups_available: bool = True
    endpoint_protection: bool = False

    @model_validator(mode='after')
    def check(self):
        ids = [s.id for s in self.services]
        if len(ids) != len(set(ids)):
            raise ValueError('Service ids must be unique.')
        for s in self.services:
            for d in s.depends_on:
                if d not in ids:
                    raise ValueError(f'{s.id} depends on unknown service {d}.')
                if d == s.id:
                    raise ValueError(f'{s.id} cannot depend on itself.')
        return self


def hosts_index(layout: Layout) -> dict[str, dict]:
    out = {}
    for r in layout.racks:
        for d in r.devices:
            if d.kind in ('compute', 'storage', 'network'):
                out[d.id] = {'id': d.id, 'name': d.name, 'kind': d.kind, 'rack': r.id, 'rack_name': r.name, 'segment': d.segment,
                             'os': d.os, 'patched': d.patched, 'rack_online': rack_online(r, layout)}
    return out


def spread(threat: Threat, hosts: dict[str, dict], model: SoftwareModel) -> tuple[set[str], list[str]]:
    """Breadth-first propagation over hosts. Returns infected ids and a hop-by-hop trace."""
    if threat.origin_host not in hosts:
        return set(), [f'{threat.origin_host} is not a host in the layout; threat ignored.']
    origin = hosts[threat.origin_host]
    infected = {origin['id']}
    trace = [f'Hop 0 · {threat.kind} lands on {origin["id"]} ({origin["segment"]} segment).']
    if threat.kind == 'misconfiguration':
        return infected, trace + ['Configuration faults do not propagate over the network.']
    if threat.kind == 'bad_patch':
        peers = {h for h, v in hosts.items() if v['segment'] == origin['segment'] and v['patched']}
        return infected | peers, trace + [f'Rollout reaches {len(peers)} patched host(s) in {origin["segment"]}.']
    crosses = threat.kind == 'worm' and not model.segmentation
    frontier = deque([(origin['id'], 0)])
    while frontier:
        hid, hop = frontier.popleft()
        if hop >= threat.hops:
            continue
        here = hosts[hid]
        new = []
        for other, v in hosts.items():
            if other in infected or not v['rack_online']:
                continue
            same = v['segment'] == here['segment']
            if not same and not crosses:
                continue
            if v['patched'] and threat.kind != 'ransomware':
                continue
            if model.endpoint_protection and threat.kind == 'virus':
                continue
            infected.add(other)
            new.append(other)
            frontier.append((other, hop + 1))
        if new:
            trace.append(f'Hop {hop + 1} · {hid} reaches {", ".join(new)}.')
    if len(trace) == 1:
        trace.append('No further hosts reachable: segmentation, patch level or protection stopped the spread.')
    return infected, trace


TIER_ORDER = ['hypervisor', 'operating_system', 'identity', 'database', 'message_queue', 'orchestration', 'load_balancer', 'application', 'monitoring', 'backup']


def evaluate_software(model: SoftwareModel) -> dict:
    hosts = hosts_index(model.layout)
    infected: set[str] = set()
    traces = []
    recovery_hours = 0.0
    ransomware = False
    for t in model.threats:
        hit, trace = spread(t, hosts, model)
        infected |= hit
        traces.append({'kind': t.kind, 'origin': t.origin_host, 'infected': sorted(hit), 'trace': trace, 'description': THREAT_TEXT[t.kind]})
        recovery_hours = max(recovery_hours, THREAT_RECOVERY_HOURS[t.kind] * (2 if t.kind == 'ransomware' and not model.backups_available else 1))
        ransomware |= t.kind == 'ransomware'
    host_states = []
    for h in hosts.values():
        reason = None
        if h['id'] in model.failed_hosts:
            reason = 'hardware failure'
        elif not h['rack_online']:
            reason = 'rack offline'
        elif h['id'] in infected:
            reason = 'compromised'
        host_states.append({**h, 'online': reason is None, 'reason': reason})
    online_hosts = {h['id'] for h in host_states if h['online']}
    # Resolve services in dependency order (iterate to a fixed point for arbitrary graphs).
    states: dict[str, dict] = {}
    services = {s.id: s for s in model.services}
    for _ in range(len(services) + 1):
        changed = False
        for s in model.services:
            healthy = [h for h in s.hosts if h in online_hosts]
            missing = [h for h in s.hosts if h not in hosts]
            data_lost = ransomware and s.stateful and any(h in infected for h in s.hosts) and not model.backups_available
            deps_down = [d for d in s.depends_on if d in states and not states[d]['up']]
            replicas_ok = len(healthy) >= s.min_replicas and not data_lost
            up = replicas_ok and not deps_down
            reason = ('data loss without backups' if data_lost else f'{len(healthy)}/{s.min_replicas} replicas' if not replicas_ok
                      else f'dependency down: {", ".join(deps_down)}' if deps_down else 'operational')
            new = {'id': s.id, 'name': s.name, 'tier': s.tier, 'up': up, 'healthy_replicas': len(healthy), 'total_replicas': len(s.hosts),
                   'min_replicas': s.min_replicas, 'reason': reason, 'degraded': up and len(healthy) < len(s.hosts), 'missing_hosts': missing,
                   'depends_on': s.depends_on, 'stateful': s.stateful}
            if states.get(s.id) != new:
                states[s.id] = new
                changed = True
        if not changed:
            break
    ordered = sorted(states.values(), key=lambda x: (TIER_ORDER.index(x['tier']), x['id']))
    up = sum(1 for s in ordered if s['up'])
    apps = [s for s in ordered if s['tier'] == 'application']
    recommendations = []
    if infected and not model.segmentation:
        recommendations.append('Enable network segmentation: worms currently cross every segment.')
    if any(not h['patched'] for h in hosts.values()):
        recommendations.append(f'{sum(1 for h in hosts.values() if not h["patched"])} host(s) are unpatched and remain susceptible to virus and worm spread.')
    if not model.backups_available and any(s.stateful for s in model.services):
        recommendations.append('Stateful services have no backup path: ransomware becomes permanent data loss.')
    for s in ordered:
        if s['total_replicas'] <= s['min_replicas'] and s['total_replicas']:
            recommendations.append(f'{s["name"]} has no spare replica ({s["total_replicas"]} hosts, needs {s["min_replicas"]}).')
        racks = {hosts[h]['rack'] for h in services[s['id']].hosts if h in hosts}
        if len(racks) == 1 and s['total_replicas'] > 1:
            recommendations.append(f'All {s["name"]} replicas sit in rack {next(iter(racks))}: a single rack fault removes the service.')
    return {'hosts': host_states, 'services': ordered, 'threats': traces, 'infected_hosts': sorted(infected),
            'services_up': up, 'services_total': len(ordered), 'applications_up': sum(1 for s in apps if s['up']), 'applications_total': len(apps),
            'estimated_recovery_hours': recovery_hours, 'state': 'NORMAL' if up == len(ordered) and not infected else 'CRITICAL' if apps and not any(s['up'] for s in apps) else 'DEGRADED',
            'recommendations': recommendations,
            'note': 'Deterministic dependency and propagation model. Recovery hours are editable planning assumptions; no exploit behaviour is simulated.'}


@router.post('/software/evaluate')
def software_evaluate(model: SoftwareModel):
    return evaluate_software(model)


@router.get('/software/catalog')
def software_catalog():
    return {'threats': [{'kind': k, 'recovery_hours': THREAT_RECOVERY_HOURS[k], 'description': THREAT_TEXT[k]} for k in THREAT_RECOVERY_HOURS],
            'tiers': TIER_ORDER, 'device_kinds': ['compute', 'storage', 'network', 'ups', 'blank']}


def default_layout() -> dict:
    racks = []
    n = 0
    for row in range(2):
        for col in range(6):
            n += 1
            rid = f'R{row + 1:02d}-{col + 1:02d}'
            devices = []
            u = 1
            kinds = ['network'] + ['compute'] * 6 + ['storage'] * 2 if col % 3 else ['network'] + ['compute'] * 8
            for i, kind in enumerate(kinds):
                h = 1 if kind == 'network' else 4 if kind == 'storage' else 2
                devices.append({'id': f'{rid}-{kind[:3].upper()}{i + 1:02d}', 'name': f'{kind.title()} {i + 1}', 'kind': kind, 'u_position': u, 'height_u': h,
                                'power_kw': .3 if kind == 'network' else 1.2 if kind == 'storage' else .8, 'os': 'Network OS' if kind == 'network' else 'Linux',
                                'segment': 'prod' if row == 0 else 'mgmt' if col == 0 else 'prod', 'patched': not (row == 1 and col == 5)})
                u += h
            racks.append({'id': rid, 'name': f'Rack {rid}', 'row': row, 'col': col, 'height_u': 42, 'max_power_kw': 12, 'feed': 'AB' if col != 5 else 'A',
                          'cooling_zone': f'Zone {row + 1}', 'devices': devices})
    return {'name': 'Data hall 1', 'rows': 3, 'cols': 8, 'racks': racks, 'failed_feeds': [], 'failed_zones': [], 'failed_racks': []}


def default_services(layout: dict) -> list[dict]:
    compute = [d['id'] for r in layout['racks'] for d in r['devices'] if d['kind'] == 'compute']
    storage = [d['id'] for r in layout['racks'] for d in r['devices'] if d['kind'] == 'storage']
    return [
        {'id': 'hv', 'name': 'Hypervisor cluster', 'tier': 'hypervisor', 'hosts': compute[:12], 'min_replicas': 8, 'depends_on': [], 'stateful': False},
        {'id': 'idp', 'name': 'Identity / directory', 'tier': 'identity', 'hosts': compute[12:15], 'min_replicas': 1, 'depends_on': ['hv'], 'stateful': True},
        {'id': 'db', 'name': 'Primary database', 'tier': 'database', 'hosts': storage[:4], 'min_replicas': 2, 'depends_on': ['hv'], 'stateful': True},
        {'id': 'mq', 'name': 'Message queue', 'tier': 'message_queue', 'hosts': compute[15:18], 'min_replicas': 2, 'depends_on': ['hv'], 'stateful': True},
        {'id': 'k8s', 'name': 'Container orchestration', 'tier': 'orchestration', 'hosts': compute[18:21], 'min_replicas': 2, 'depends_on': ['hv', 'idp'], 'stateful': False},
        {'id': 'lb', 'name': 'Load balancer', 'tier': 'load_balancer', 'hosts': compute[21:23], 'min_replicas': 1, 'depends_on': [], 'stateful': False},
        {'id': 'web', 'name': 'Customer web application', 'tier': 'application', 'hosts': compute[23:29], 'min_replicas': 3, 'depends_on': ['k8s', 'db', 'mq', 'lb'], 'stateful': False},
        {'id': 'api', 'name': 'Payments API', 'tier': 'application', 'hosts': compute[29:33], 'min_replicas': 2, 'depends_on': ['k8s', 'db', 'idp'], 'stateful': False},
        {'id': 'mon', 'name': 'Monitoring & logging', 'tier': 'monitoring', 'hosts': compute[33:36], 'min_replicas': 1, 'depends_on': [], 'stateful': True},
        {'id': 'bkp', 'name': 'Backup service', 'tier': 'backup', 'hosts': storage[4:8], 'min_replicas': 1, 'depends_on': [], 'stateful': True},
    ]


@router.get('/software/default')
def software_default():
    layout = default_layout()
    return {'layout': layout, 'services': default_services(layout)}
