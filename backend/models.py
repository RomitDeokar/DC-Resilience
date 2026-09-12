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

class IT(StrictModel):
    enabled: bool = True
    redundancy: Redundancy = 'N+1'
    server_nodes_required: int = Field(12, ge=1, le=50)

class Maintenance(StrictModel):
    enabled: bool = False
    component_id: str = Field('UPS-A01', pattern=r'^(UPS|GEN|PDU|ATS|CRAC|SRV|NET|STO|APP)-A[0-9]{2}$')
    start_hour: float = Field(1000, ge=0, le=43800)
    duration_hours: float = Field(4, gt=0, le=168)
    inject_failure: bool = False

class Budget(StrictModel):
    # Planning inputs, NOT researched prices or equipment quotations.
    ups_inr_per_kw: float = Field(15000, ge=0, le=1000000)
    generator_inr_per_kw: float = Field(12000, ge=0, le=1000000)
    pdu_inr_per_kw: float = Field(2000, ge=0, le=1000000)
    crac_inr_per_kw: float = Field(25000, ge=0, le=1000000)
    ats_inr_per_kw: float = Field(1000, ge=0, le=1000000)
    server_node_inr: float = Field(300000, ge=0, le=100000000)
    network_replica_inr: float = Field(200000, ge=0, le=100000000)
    storage_replica_inr: float = Field(600000, ge=0, le=100000000)

class Simulation(StrictModel):
    num_trials: int = Field(10000, ge=100, le=20000)
    simulated_years_per_trial: int = Field(1, ge=1, le=5)
    seed: int = Field(42, ge=0, le=4294967295)
    failure_mode: Literal['overlapping', 'single'] = 'overlapping'
    stress_multiplier: Literal[1, 5, 20] = 1
    operating_mode: Literal['islanded', 'utility'] = 'islanded'
    dependent_failures: bool = False
    common_cause_probability: float = Field(.1, ge=0, le=1)
    common_cause_events_per_year: float = Field(1, ge=0, le=10)
    common_cause_duration_hours: float = Field(4, gt=0, le=168)
    common_cause_scope: Literal['bank', 'site'] = 'bank'
    diagnostics: bool = False
    generator_rate_basis: Literal['published', 'count_exposure'] = 'published'

class Facility(StrictModel):
    facility_name: str = Field('SRM Research Facility', min_length=1, max_length=80)
    tier_target: Literal['I', 'II', 'III', 'IV'] = 'III'
    it_load_kw: float = Field(10000, ge=500, le=50000)
    power: Power = Field(default_factory=Power)
    cooling: Cooling = Field(default_factory=Cooling)
    simulation: Simulation = Field(default_factory=Simulation)
    it: IT = Field(default_factory=IT)
    maintenance: Maintenance = Field(default_factory=Maintenance)
    budget: Budget = Field(default_factory=Budget)

    @model_validator(mode='after')
    def bound_work(self):
        estimate = work_estimate(self)
        if estimate['comparison_components'] > 160:
            raise ValueError('Facility exceeds 160 comparison components. Increase unit capacity or reduce load/server nodes.')
        if estimate['unit_trials'] > 45000000:
            raise ValueError(f"Experiment exceeds 45M weighted unit-trials. Use at most {estimate['max_trials']} trials, or reduce years/stress/components.")
        if self.simulation.failure_mode == 'single' and (self.simulation.dependent_failures or self.maintenance.enabled):
            raise ValueError('Maintenance/dependent failures require overlapping mode; single-failure suppression would invalidate them.')
        if self.maintenance.enabled:
            # Maintenance must refer to a component existing in every comparison variant.
            base = self.model_copy(deep=True)
            base.power.redundancy = base.cooling.redundancy = base.it.redundancy = 'N'
            valid = {c['id'] for g in topology(base) for c in g['components']}
            if self.maintenance.component_id not in valid:
                raise ValueError('Maintenance target must exist in the N baseline (A bank).')
            if self.maintenance.start_hour + self.maintenance.duration_hours > self.simulation.simulated_years_per_trial * 8760:
                raise ValueError('Maintenance window must fit completely within the trial horizon.')

        return self

def work_estimate(config: Facility) -> dict:
    capacities = [config.power.ups_capacity_kw_each, config.power.generator_capacity_kw_each,
                  config.power.pdu_capacity_kw_each, config.cooling.crac_capacity_kw_each, config.it_load_kw]
    components = sum(2 * math.ceil(config.it_load_kw / c) for c in capacities)
    if config.it.enabled:
        components += 2 * (config.it.server_nodes_required + 3)
    # OS/hypervisor hazards share server IDs but need separate random streams.
    streams = components + (2 * config.it.server_nodes_required if config.it.enabled else 0)
    weight = streams * config.simulation.simulated_years_per_trial * config.simulation.stress_multiplier
    return {'comparison_components': components, 'unit_trials': weight * config.simulation.num_trials,
            'limit': 45000000, 'max_trials': min(20000, 45000000 // weight), 'concurrent_jobs': 2,
            'diagnostic_trials': min(config.simulation.num_trials, 1000)}


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
    if config.it.enabled:
        specs.extend([('SERVER', 'SRV', config.it_load_kw / config.it.server_nodes_required, 'it'),
                      ('NETWORK', 'NET', config.it_load_kw, 'it'),
                      ('STORAGE', 'STO', config.it_load_kw, 'it'),
                      ('APPLICATION', 'APP', config.it_load_kw, 'it')])
    groups = []
    for kind, short, capacity, subsystem in specs:
        redundancy = getattr(config, subsystem).redundancy
        required = config.it.server_nodes_required if kind == 'SERVER' else math.ceil(config.it_load_kw / capacity)
        count = required + (redundancy == 'N+1')
        banks = ['A', 'B'] if redundancy == '2N' else ['A']
        groups.append({'kind': kind, 'short': short, 'subsystem': subsystem,
                       'redundancy': redundancy, 'required_units': required,
                       'capacity_kw_each': capacity, 'capacity_basis': 'workload-equivalent kW, not electrical draw' if subsystem == 'it' else 'supported IT kW',
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
        self.healthy = {g['kind']: {b: sum(c['bank'] == b for c in g['components'])
                                        for b in ['A', 'B']} for g in groups}
        self.banks = {g['kind']: {b: self.healthy[g['kind']][b] * g['capacity_kw_each']
                                      for b in ['A', 'B']} for g in groups}
        self.power_kinds = ['UPS_MODULE', 'PDU', 'ATS']
        if config.simulation.operating_mode == 'islanded':
            self.power_kinds.append('GENERATOR')

    def update(self, cid: str, failed: bool):
        if failed == (cid in self.failed):
            return
        c = self.units[cid]
        # Integer health counts prevent fractional server capacity from drifting
        # below zero after repeated hardware/software fail-repair cycles.
        self.healthy[c['kind']][c['bank']] += -1 if failed else 1
        self.banks[c['kind']][c['bank']] = self.healthy[c['kind']][c['bank']] * c['capacity_kw']
        if failed:
            self.failed.add(cid)
        else:
            self.failed.discard(cid)

    def capacities(self):
        # Select a complete train; never pool capacity across disconnected paths.
        power = max(min(self.banks[k][b] for k in self.power_kinds) for b in ['A', 'B'])
        cooling = max(self.banks['CRAC'].values())
        it_capacity = self.it_capacity()
        surviving = min(power, cooling, it_capacity)
        # Fractional workload shares can differ from exact demand by floating-point epsilon.
        if math.isclose(surviving, self.config.it_load_kw, rel_tol=1e-12):
            surviving = self.config.it_load_kw
        return power, cooling, surviving

    def it_capacity(self):
        if not self.config.it.enabled:
            return self.config.it_load_kw
        return max(min(self.banks[k][b] for k in ['SERVER', 'NETWORK', 'STORAGE', 'APPLICATION'])
                   for b in ['A', 'B'])


def capacity_state(config: Facility, groups: list[dict], failed: set[str]) -> dict:
    tracker = CapacityTracker(config, groups)
    for cid in failed:
        tracker.update(cid, True)
    power, cooling, surviving = tracker.capacities()
    details = [{**g, 'surviving_capacity_kw': max(tracker.banks[g['kind']].values()),
                'healthy_units': sum(c['id'] not in failed for c in g['components'])}
               for g in groups]
    return {'groups': details, 'surviving_capacity_kw': surviving,
            'power_capacity_kw': power, 'cooling_capacity_kw': cooling, 'it_capacity_kw': tracker.it_capacity(),
            'required_capacity_kw': config.it_load_kw,
            'lost_capacity_kw': max(0, config.it_load_kw - surviving),
            'service_maintained': surviving >= config.it_load_kw,
            'failed_components': sorted(failed)}
