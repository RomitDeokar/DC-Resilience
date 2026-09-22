"""Facility planning and synthetic DCIM, complementing the research engine.

Capability reference: ShouryaSaran/DC-Resilience, snapshot a06534c.
Reimplemented against this app's strict validation and stateless API. Planning
scores are not probabilities, and this simplified graph is not a Tier audit.
"""
import asyncio
import math
import random
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import Field, ValidationError
from .models import StrictModel

router = APIRouter()
Architecture = Literal['N', 'N+1', 'N+2', '2N']
DISCLAIMER = 'Educational planning assessment, not Uptime Institute Tier certification. Scores are application-defined, not availability predictions.'


class Design(StrictModel):
    facility_name: str = Field('DC-01 · Research facility', min_length=1, max_length=80)
    it_load_kw: float = Field(500, gt=0, le=50000)
    rack_count: int = Field(40, ge=1, le=10000)
    rack_density_kw: float = Field(12.5, gt=0, le=200)
    availability_percent: float = Field(99.982, gt=0, le=100)
    tier_target: Literal['I', 'II', 'III', 'IV'] = 'III'
    redundancy: Architecture = 'N+1'
    expected_pue: float = Field(1.5, ge=1, le=3)
    utility_feeds: int = Field(2, ge=0, le=4)
    ups_units: int = Field(3, ge=1, le=24)
    ups_capacity_kw: float = Field(250, gt=0, le=100000)
    ups_efficiency: float = Field(95, ge=50, le=100)
    generator_units: int = Field(2, ge=0, le=24)
    generator_capacity_kw: float = Field(800, gt=0, le=100000)
    fuel_hours: float = Field(48, ge=0, le=720)
    battery_minutes: float = Field(15, ge=0, le=240)
    cooling_architecture: Literal['Chilled water', 'Air cooled', 'In-row cooling'] = 'Chilled water'
    cooling_redundancy: Architecture = 'N+1'
    cooling_units: int = Field(3, ge=1, le=24)
    cooling_capacity_kw: float = Field(250, gt=0, le=100000)
    power_losses_kw: float = Field(50, ge=0, le=50000)
    supply_temp_c: float = Field(22, ge=15, le=35)
    isp_connections: int = Field(2, ge=1, le=8)
    core_switches: int = Field(2, ge=1, le=16)
    distribution_switches: int = Field(4, ge=1, le=24)
    network_redundancy: Literal['Single path', 'Dual path', 'N+1', '2N'] = 'Dual path'


class PowerInput(StrictModel):
    it_load_kw: float = Field(500, gt=0, le=1000000)
    expected_pue: float = Field(1.5, ge=1, le=3)
    ups_efficiency: float = Field(95, ge=50, le=100)
    redundancy: Architecture = 'N+1'
    ups_unit_capacity_kw: float = Field(250, gt=0, le=1000000)


class CoolingInput(StrictModel):
    it_load_kw: float = Field(500, gt=0, le=1000000)
    power_losses_kw: float = Field(50, ge=0, le=1000000)
    cooling_unit_capacity_kw: float = Field(250, gt=0, le=1000000)
    redundancy: Architecture = 'N+1'


class RackInput(StrictModel):
    rack_count: int = Field(40, ge=1, le=100000)
    avg_rack_kw: float = Field(12.5, gt=0, le=1000)
    target_it_load_kw: float = Field(500, gt=0, le=1000000)


class PueInput(StrictModel):
    it_energy_kwh: float = Field(100000, gt=0, le=1e12)
    cooling_energy_kwh: float = Field(35000, ge=0, le=1e12)
    power_losses_kwh: float = Field(10000, ge=0, le=1e12)
    lighting_misc_kwh: float = Field(5000, ge=0, le=1e12)


class WueInput(StrictModel):
    annual_water_usage_liters: float = Field(2000000, ge=0, le=1e15)
    it_equipment_energy_kwh: float = Field(4380000, gt=0, le=1e12)


class SlaInput(StrictModel):
    availability_percent: float = Field(99.982, gt=0, le=100)


def installed(n, architecture):
    return n * 2 if architecture == '2N' else n + {'N': 0, 'N+1': 1, 'N+2': 2}[architecture]


def result(values, formula, note):
    return {'values': values, 'formula': formula, 'note': note}


@router.post('/api/calculations/power')
def power(c: PowerInput):
    # Nameplate here is UPS output rating. Efficiency affects input draw, not output sizing.
    n = math.ceil(c.it_load_kw / c.ups_unit_capacity_kw)
    units = installed(n, c.redundancy)
    capacity = units * c.ups_unit_capacity_kw
    return result({'Facility power (kW)': c.it_load_kw * c.expected_pue,
                   'UPS input draw (kW)': c.it_load_kw / (c.ups_efficiency / 100),
                   'Required UPS units (N)': n, 'Installed UPS units': units,
                   'Installed output capacity (kW)': capacity,
                   'Spare output capacity (kW)': capacity - c.it_load_kw,
                   'After one loss margin (kW)': (units - 1) * c.ups_unit_capacity_kw - c.it_load_kw,
                   'UPS utilization (%)': c.it_load_kw / capacity * 100,
                   'Generator design load (kW)': c.it_load_kw * c.expected_pue * 1.25},
                  'Facility = IT × PUE; N = ceil(IT / UPS output rating); input = IT / efficiency.',
                  'UPS ratings are output kW. Generator design load includes an illustrative 25% allowance, before redundancy. 2N requires two independent full-capacity paths; aggregate counts alone do not prove this.')


@router.post('/api/calculations/cooling')
def cooling(c: CoolingInput):
    heat = c.it_load_kw + c.power_losses_kw
    units = installed(math.ceil(heat / c.cooling_unit_capacity_kw), c.redundancy)
    capacity = units * c.cooling_unit_capacity_kw
    return result({'Heat rejection (kW)': heat, 'Heat rejection (BTU/hr)': heat * 3412.142,
                   'Refrigeration (TR)': heat / 3.51685, 'Installed cooling units': units,
                   'Installed cooling (kW)': capacity, 'Spare cooling (kW)': capacity - heat,
                   'Cooling utilization (%)': heat / capacity * 100},
                  'Heat = IT + electrical losses; BTU/hr = kW × 3412.142; TR = kW / 3.51685.',
                  'Steady-state sensible heat estimate. No humidity, airflow, ambient derating or thermal inertia model.')


@router.post('/api/calculations/racks')
def racks(c: RackInput):
    capacity = c.rack_count * c.avg_rack_kw
    return result({'Rack capacity (kW)': capacity, 'Utilization (%)': c.target_it_load_kw / capacity * 100,
                   'Remaining capacity (kW)': capacity - c.target_it_load_kw},
                  'Rack capacity = rack count × average kW per rack.',
                  ('Standard' if c.avg_rack_kw <= 8 else 'Medium-high' if c.avg_rack_kw <= 15 else 'High / AI-compute') + ' density planning band. Negative headroom indicates insufficient capacity.')


@router.post('/api/calculations/pue')
def pue(c: PueInput):
    total = c.it_energy_kwh + c.cooling_energy_kwh + c.power_losses_kwh + c.lighting_misc_kwh
    ratio = total / c.it_energy_kwh
    return result({'PUE': ratio, 'Total facility energy (kWh)': total,
                   'Infrastructure overhead (kWh)': total - c.it_energy_kwh},
                  'PUE = total facility energy / IT energy (same measurement period).',
                  ('Excellent' if ratio < 1.2 else 'Good' if ratio < 1.5 else 'Average' if ratio < 1.8 else 'High overhead') + ' — illustrative efficiency band, not certification.')


@router.post('/api/calculations/wue')
def wue(c: WueInput):
    return result({'WUE (L/kWh)': c.annual_water_usage_liters / c.it_equipment_energy_kwh},
                  'WUE = annual site water consumption (L) / annual IT energy (kWh).',
                  'Use matching annual boundaries. Site WUE excludes off-site electricity-generation water use.')


@router.post('/api/calculations/sla')
def sla(c: SlaInput):
    u = 1 - c.availability_percent / 100
    return result({'Downtime per year (minutes)': u * 8760 * 60,
                   'Downtime per month (minutes)': u * 8760 * 60 / 12,
                   'Downtime per week (seconds)': u * 7 * 24 * 3600,
                   'Downtime per day (seconds)': u * 86400},
                  'Allowed downtime = (1 − availability / 100) × period.',
                  '365-day / 8,760-hour year, consistent with the research engine. Monthly value is an annual average, not a calendar-month SLA.')


@router.get('/api/infrastructure/default')
def default_design():
    return Design()


def nodes_for(c: Design):
    specs = [('utility', c.utility_feeds, 'Utility feed', c.it_load_kw * c.expected_pue),
             ('generator', c.generator_units, 'Generator', c.generator_capacity_kw),
             ('ups', c.ups_units, 'UPS module', c.ups_capacity_kw),
             ('cooling', c.cooling_units, 'Cooling unit', c.cooling_capacity_kw),
             ('isp', c.isp_connections, 'ISP transit', 0),
             ('core', c.core_switches, 'Core switch', 0),
             ('distribution', c.distribution_switches, 'Distribution switch', 0)]
    return [{'id': f'{kind}-{i+1}', 'kind': kind, 'name': f'{label} {i+1}',
             'capacity_kw': cap, 'status': 'operational'}
            for kind, count, label, cap in specs for i in range(count)]


class Scenario(StrictModel):
    design: Design = Field(default_factory=Design)
    failed_components: list[str] = Field(default_factory=list, max_length=124)
    elapsed_minutes: float = Field(0, ge=0, le=43200)


def evaluate(s: Scenario):
    c = s.design
    nodes = nodes_for(c)
    failed = set(s.failed_components)
    if failed - {n['id'] for n in nodes}:
        raise HTTPException(422, 'Unknown component IDs for this facility design.')
    def count(kind):
        return sum(n['kind'] == kind and n['id'] not in failed for n in nodes)
    utility = count('utility') > 0
    gen_capacity = count('generator') * c.generator_capacity_kw if s.elapsed_minutes < c.fuel_hours * 60 else 0
    source_ratio = 1 if utility else min(1, gen_capacity / (c.it_load_kw * c.expected_pue))
    battery_active = source_ratio < 1 and s.elapsed_minutes < c.battery_minutes
    # Battery sustains IT only, not the mechanical plant. No implicit cooling ride-through.
    ups = count('ups') * c.ups_capacity_kw
    power_kw = min(ups, c.it_load_kw * (1 if battery_active else source_ratio))
    heat = c.it_load_kw + c.power_losses_kw
    cooling_kw = count('cooling') * c.cooling_capacity_kw * source_ratio
    network = count('isp') > 0 and count('core') > 0 and count('distribution') > 0
    served = max(0, min(c.it_load_kw, power_kw, c.it_load_kw * cooling_kw / heat, c.it_load_kw if network else 0))
    maintained = math.isclose(served, c.it_load_kw, rel_tol=1e-10)
    for node in nodes:
        node['status'] = 'failed' if node['id'] in failed else ('warning' if (node['kind'] == 'cooling' and source_ratio < 1) or (node['kind'] in ['ups', 'core', 'distribution'] and power_kw < c.it_load_kw) else 'operational')
    return {'nodes': nodes, 'state': 'CRITICAL' if not maintained else 'DEGRADED' if failed else 'NORMAL',
            'service_maintained': maintained, 'served_it_kw': served, 'lost_it_kw': c.it_load_kw - served,
            'power_kw': power_kw, 'cooling_kw': cooling_kw, 'network_online': network,
            'source': 'Utility' if utility else 'Generator + battery' if battery_active and gen_capacity else 'Battery (IT only)' if battery_active else 'Generator' if gen_capacity else 'Unavailable',
            'failed_components': sorted(failed), 'timestamp': datetime.now(timezone.utc).isoformat(),
            'note': 'Simplified pooled-capacity graph; topology independence is not verified. No ATS switching delay or thermal inertia. Battery supports IT only; cooling needs utility/generator power. Elapsed time controls battery and fuel exhaustion.'}


@router.post('/api/operations/failure')
def failure(s: Scenario):
    return evaluate(s)


@router.post('/api/infrastructure/analyze')
def analyze(c: Design):
    heat = c.it_load_kw + c.power_losses_kw
    specs = [('Power', c.ups_units, c.ups_capacity_kw, c.it_load_kw, c.redundancy),
             ('Cooling', c.cooling_units, c.cooling_capacity_kw, heat, c.cooling_redundancy),
             ('Generator', c.generator_units, c.generator_capacity_kw, c.it_load_kw * c.expected_pue, 'Standby')]
    subsystems = []
    for name, count, cap, demand, arch in specs:
        total = count * cap
        margin = (max(0, count - 1) * cap) - demand
        subsystems.append({'name': name, 'installed_kw': total, 'required_kw': demand,
                           'margin_kw': total - demand, 'after_failure_margin_kw': margin,
                           'single_failure_survivable': margin >= 0, 'units': count,
                           'utilization_percent': demand / total * 100 if total else None,
                           'architecture': arch})
    p, cool, gen = subsystems
    net = min(c.isp_connections, c.core_switches, c.distribution_switches) >= 2 and c.network_redundancy != 'Single path'
    rack_ok = c.rack_count * c.rack_density_kw >= c.it_load_kw
    checks = [
        ('UPS single-unit tolerance', p['single_failure_survivable'], 25, 'Capacity after losing one UPS meets the IT load.'),
        ('Cooling single-unit tolerance', cool['single_failure_survivable'], 25, 'Capacity after losing one unit covers IT plus electrical losses.'),
        ('Network component diversity', net, 20, 'Two or more ISPs, core and distribution switches; not single-path routing.'),
        ('Standby generation tolerance', gen['single_failure_survivable'] and c.fuel_hours >= 24, 15, 'One generator can be removed while meeting facility load; at least 24 h fuel.'),
        ('Utility diversity', c.utility_feeds >= 2, 5, 'At least two configured utility feeds. Physical independence is unverified.'),
        ('Battery ride-through', c.battery_minutes >= 15, 5, 'At least 15 minutes of configured IT battery autonomy.'),
        ('Rack capacity', rack_ok, 5, 'Configured rack capacity meets the IT load.')]
    checklist = [{'criterion': name, 'met': bool(met), 'points': weight if met else 0, 'max_points': weight, 'description': description} for name, met, weight, description in checks]
    warnings = []
    for name, count, cap, demand, arch in specs[:2]:
        needed = installed(math.ceil(demand / cap), arch)
        if count < needed:
            warnings.append(f'{name}: {arch} calls for at least {needed} units; only {count} configured.')
    if c.expected_pue * c.it_load_kw < heat:
        warnings.append('Expected facility power is smaller than IT plus electrical losses; revise PUE/loss assumptions.')
    return {'design': c.model_dump(), 'facility_name': c.facility_name, 'score': sum(x['points'] for x in checklist),
            'subsystems': subsystems, 'network_survivable': net, 'checklist': checklist,
            'warnings': warnings, 'baseline': evaluate(Scenario(design=c)),
            'tier_target': c.tier_target, 'tier_note': 'Tier ' + c.tier_target + ' is a design target only. Concurrent maintainability, independent distribution paths and fault tolerance require a site-specific engineering audit.',
            'disclaimer': DISCLAIMER}


def reading(s: Scenario, step: int, rng):
    c = s.design
    state = evaluate(s)
    load = c.it_load_kw * (1 + .025 * math.sin(step / 10) + rng.uniform(-.006, .006))
    pue_value = max(1, c.expected_pue + .025 * math.sin(step / 15) + rng.uniform(-.01, .01))
    cooling_shortfall = max(0, 1 - state['cooling_kw'] / (c.it_load_kw + c.power_losses_kw))
    supply = c.supply_temp_c + math.sin(step / 8) * .6 + cooling_shortfall * 12
    available_ups = sum(n['capacity_kw'] for n in state['nodes'] if n['kind'] == 'ups' and n['status'] != 'failed')
    util = load / available_ups * 100 if available_ups else 0
    humidity = 48 + 3 * math.sin(step / 12) + rng.uniform(-.5, .5)
    alerts = []
    if not state['service_maintained']:
        alerts.append({'id': 'service', 'severity': 'critical', 'message': 'Modeled service capacity is below demand.'})
    if not available_ups or util > 90:
        alerts.append({'id': 'ups', 'severity': 'critical' if not available_ups or util > 100 else 'warning', 'message': 'UPS demand exceeds the 90% planning threshold.'})
    if supply > 27:
        alerts.append({'id': 'thermal', 'severity': 'warning', 'message': 'Synthetic supply temperature exceeds 27°C.'})
    if pue_value > 1.8:
        alerts.append({'id': 'pue', 'severity': 'warning', 'message': 'Synthetic PUE exceeds 1.80.'})
    return {'timestamp': datetime.now(timezone.utc).isoformat(), 'synthetic': True,
            'it_load_kw': round(load, 2), 'facility_load_kw': round(load * pue_value, 2),
            'ups_load_percent': round(util, 2), 'supply_temp_c': round(supply, 2),
            'return_temp_c': round(supply + 10 + load / c.it_load_kw, 2),
            'humidity_percent': round(humidity, 2), 'pue': round(pue_value, 3),
            'cooling_load_kw': round(load + c.power_losses_kw, 2),
            'served_it_kw': state['served_it_kw'], 'state': state['state'], 'alerts': alerts}


@router.post('/api/telemetry/current')
def telemetry_snapshot(s: Scenario):
    return reading(s, 0, random.Random())


@router.websocket('/ws/telemetry')
async def telemetry(ws: WebSocket):
    await ws.accept()
    # Every connection owns its config and RNG. Never leak one visitor's faults to another.
    scenario, step, rng = Scenario(), 0, random.Random()
    try:
        payload = await asyncio.wait_for(ws.receive_json(), timeout=15)
        scenario = Scenario.model_validate(payload)
        evaluate(scenario)
        while True:
            await ws.send_json(reading(scenario, step, rng))
            step += 1
            try:
                payload = await asyncio.wait_for(ws.receive_json(), timeout=2)
                scenario = Scenario.model_validate(payload)
                evaluate(scenario)
            except asyncio.TimeoutError:
                pass
    except (WebSocketDisconnect, RuntimeError):
        pass
    except (ValidationError, HTTPException, ValueError, asyncio.TimeoutError):
        await ws.close(code=1008, reason='Invalid facility scenario or missing initial configuration.')
