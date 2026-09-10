"""Validated facility inputs and explicit capacity-aware redundant topologies."""
import math
from typing import Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator

Redundancy = Literal['N', 'N+1', '2N']
TIERS = {'I': 99.671, 'II': 99.741, 'III': 99.982, 'IV': 99.995}

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, str_strip_whitespace=True)

class Power(StrictModel):
    redundancy: Redundancy = 'N+1'
    ups_capacity_kw_each: float = Field(2500, ge=100, le=50000)
    generator_capacity_kw_each: float = Field(5000, ge=100, le=100000)
    pdu_capacity_kw_each: float = Field(2500, ge=100, le=50000)

class Cooling(StrictModel):
    redundancy: Redundancy = 'N+1'
    crac_capacity_kw_each: float = Field(2000, ge=100, le=50000)

class Simulation(StrictModel):
    num_trials: int = Field(10000, ge=100, le=20000)
    simulated_years_per_trial: int = Field(1, ge=1, le=5)
    seed: int = Field(42, ge=0, le=4294967295)
    failure_mode: Literal['overlapping', 'single'] = 'overlapping'
    stress_multiplier: Literal[1, 5, 20] = 1
    operating_mode: Literal['islanded', 'utility'] = 'islanded'

class Facility(StrictModel):
    facility_name: str = Field('SRM Research Facility', min_length=1, max_length=80)
    tier_target: Literal['I', 'II', 'III', 'IV'] = 'III'
    it_load_kw: float = Field(10000, ge=500, le=50000)
    power: Power = Field(default_factory=Power)
    cooling: Cooling = Field(default_factory=Cooling)
    simulation: Simulation = Field(default_factory=Simulation)

    @model_validator(mode='after')
    def bound_work(self):
        capacities = [self.power.ups_capacity_kw_each, self.power.generator_capacity_kw_each,
                      self.power.pdu_capacity_kw_each, self.cooling.crac_capacity_kw_each, self.it_load_kw]
        # Bound the largest (2N) comparison, not just the selected architecture.
        components = sum(2 * math.ceil(self.it_load_kw / c) for c in capacities)
        if components > 160:
            raise ValueError('Facility exceeds 160 comparison components. Increase unit capacity or reduce IT load.')
        work = components * self.simulation.num_trials * self.simulation.simulated_years_per_trial * self.simulation.stress_multiplier
        if work > 45000000:
            raise ValueError('Experiment too large. Reduce trials, years, stress, or component count.')
        return self

class Injection(StrictModel):
    config: Facility
    failed_components: list[str] = Field(default_factory=list, max_length=160)
    duration_hours: float = Field(4, ge=0, le=8760)


def topology(config: Facility) -> list[dict]:
    specs = [('UPS_MODULE', 'UPS', config.power.ups_capacity_kw_each, 'power'),
             ('GENERATOR', 'GEN', config.power.generator_capacity_kw_each, 'power'),
             ('PDU', 'PDU', config.power.pdu_capacity_kw_each, 'power'),
             ('ATS', 'ATS', config.it_load_kw, 'power'),
             ('CRAC', 'CRAC', config.cooling.crac_capacity_kw_each, 'cooling')]
    groups = []
    for kind, short, capacity, subsystem in specs:
        redundancy = getattr(config, subsystem).redundancy
        required = math.ceil(config.it_load_kw / capacity)
        count = required + (redundancy == 'N+1')
        banks = ['A', 'B'] if redundancy == '2N' else ['A']
        groups.append({'kind': kind, 'short': short, 'subsystem': subsystem,
                       'redundancy': redundancy, 'required_units': required,
                       'capacity_kw_each': capacity,
                       'components': [{'id': f'{short}-{bank}{i+1:02}', 'bank': bank,
                                       'capacity_kw': capacity, 'kind': kind}
                                      for bank in banks for i in range(count)]})
    return groups


class CapacityTracker:
    """Incremental capacity state shared by injection and the chronological engine."""
    def __init__(self, config: Facility, groups: list[dict]):
        self.config = config
        self.failed = set()
        self.units = {c['id']: c for g in groups for c in g['components']}
        self.banks = {g['kind']: {b: sum(c['capacity_kw'] for c in g['components']
                                      if c['bank'] == b) for b in ['A', 'B']} for g in groups}
        self.power_kinds = ['UPS_MODULE', 'PDU', 'ATS']
        if config.simulation.operating_mode == 'islanded':
            self.power_kinds.append('GENERATOR')

    def update(self, cid: str, failed: bool):
        if failed == (cid in self.failed):
            return
        c = self.units[cid]
        self.banks[c['kind']][c['bank']] += (-1 if failed else 1) * c['capacity_kw']
        if failed:
            self.failed.add(cid)
        else:
            self.failed.discard(cid)

    def capacities(self):
        # Select a complete train; never pool capacity across disconnected paths.
        power = max(min(self.banks[k][b] for k in self.power_kinds) for b in ['A', 'B'])
        cooling = max(self.banks['CRAC'].values())
        return power, cooling, min(power, cooling)


def capacity_state(config: Facility, groups: list[dict], failed: set[str]) -> dict:
    tracker = CapacityTracker(config, groups)
    for cid in failed:
        tracker.update(cid, True)
    power, cooling, surviving = tracker.capacities()
    details = [{**g, 'surviving_capacity_kw': max(tracker.banks[g['kind']].values()),
                'healthy_units': sum(c['id'] not in failed for c in g['components'])}
               for g in groups]
    return {'groups': details, 'surviving_capacity_kw': surviving,
            'power_capacity_kw': power, 'cooling_capacity_kw': cooling,
            'required_capacity_kw': config.it_load_kw,
            'lost_capacity_kw': max(0, config.it_load_kw - surviving),
            'service_maintained': surviving >= config.it_load_kw,
            'failed_components': sorted(failed)}
