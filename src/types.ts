export type Redundancy = 'N' | 'N+1' | '2N'
export type Page = 'simulation' | 'lab' | 'comparison' | 'history' | 'references' | 'methodology'
export interface Config {
  facility_name: string; tier_target: 'I' | 'II' | 'III' | 'IV'; it_load_kw: number;
  power: { redundancy: Redundancy; ups_capacity_kw_each: number; generator_capacity_kw_each: number; pdu_capacity_kw_each: number };
  cooling: { redundancy: Redundancy; crac_capacity_kw_each: number };
  it: {enabled: boolean; redundancy: Redundancy; server_nodes_required: number};
  maintenance: {enabled: boolean; component_id: string; start_hour: number; duration_hours: number; inject_failure: boolean};
  budget: {ups_inr_per_kw: number; generator_inr_per_kw: number; pdu_inr_per_kw: number; crac_inr_per_kw: number; ats_inr_per_kw: number; server_node_inr: number; network_replica_inr: number; storage_replica_inr: number};
  simulation: { dependent_failures: boolean; common_cause_probability: number; common_cause_events_per_year: number; common_cause_duration_hours: number; common_cause_scope: 'bank'|'site'; diagnostics: boolean; generator_rate_basis: 'published'|'count_exposure'; num_trials: number; simulated_years_per_trial: number; seed: number; failure_mode: 'single' | 'overlapping'; stress_multiplier: 1 | 5 | 20; operating_mode: 'islanded' | 'utility' }
}
export const DEFAULT_CONFIG: Config = { facility_name: 'SRM Research Facility', tier_target: 'III', it_load_kw: 10000,
  power: { redundancy: 'N+1', ups_capacity_kw_each: 2500, generator_capacity_kw_each: 5000, pdu_capacity_kw_each: 2500 },
  cooling: { redundancy: 'N+1', crac_capacity_kw_each: 2000 },
  it: {enabled: true, redundancy: 'N+1', server_nodes_required: 12},
  maintenance: {enabled: false, component_id: 'UPS-A01', start_hour: 1000, duration_hours: 4, inject_failure: false},
  budget: {ups_inr_per_kw: 15000, generator_inr_per_kw: 12000, pdu_inr_per_kw: 2000, crac_inr_per_kw: 25000, ats_inr_per_kw: 1000, server_node_inr: 300000, network_replica_inr: 200000, storage_replica_inr: 600000},
  simulation: {num_trials: 10000, simulated_years_per_trial: 1, seed: 42, failure_mode: 'overlapping', stress_multiplier: 1, operating_mode: 'islanded', dependent_failures: false, common_cause_probability: .1, common_cause_events_per_year: 1, common_cause_duration_hours: 4, common_cause_scope: 'bank', diagnostics: false, generator_rate_basis: 'published'} }
export const TIERS = { I: 99.671, II: 99.741, III: 99.982, IV: 99.995 }
export interface Component { id: string; bank: string; capacity_kw: number; kind: string }
export interface Group { kind: string; short: string; subsystem: string; redundancy: Redundancy; required_units: number; capacity_kw_each: number; capacity_basis?: string; components: Component[]; surviving_capacity_kw?: number; healthy_units?: number }
export interface FacilityState { it_capacity_kw?: number; groups: Group[]; surviving_capacity_kw: number; power_capacity_kw: number; cooling_capacity_kw: number; required_capacity_kw: number; lost_capacity_kw: number; service_maintained: boolean; failed_components: string[]; downtime_minutes?: number; duration_hours?: number; unserved_energy_kwh?: number }
export interface FailureEvent { component: string; kind: string; time_hours: number; duration_hours: number; active_failures: number; surviving_capacity_kw: number; service_maintained: boolean; trial_id: number }
export interface Trial { trial_id: number; availability_percent: number; annual_downtime_minutes: number; service_maintained: boolean; minimum_capacity_kw: number }
export interface TracePoint { cause?: string; it_capacity_kw?: number; time_hours: number; action: string; component: string; surviving_capacity_kw: number; served_it_kw: number; power_capacity_kw: number; cooling_capacity_kw: number; failed_components: string[]; service_maintained: boolean }
export interface Delta {delta_minutes: number; ci95: number[]; nonzero_pairs: number; evidence_limited: boolean}
export interface Diagnostics {trials: number; sensitivity: {kind: string; label: string; low: Delta; high: Delta}[]; baseline_downtime_minutes: number; dependent_downtime_minutes: number; dependency_effect: Delta; generator_audit: (Delta & {alternative_basis: string}) | null; basis: string}
export interface Result { budget?: {total_inr: number; basis: string; breakdown: {kind: string; units: number; unit_inr: number; subtotal_inr: number}[]}; maintenance?: {component: string; window_hours: number; maintenance_only_maintained: boolean; forced_fault: boolean; forced_fault_applied_trials?: number; forced_fault_skipped_trials?: number; window_outage_trials: number; mean_window_downtime_minutes: number; window_outage_probability_ci95: number[]} | null; scenario_events?: Record<string,number>; scenario_incidents?: Record<string,number>; effective_rates?: Record<string,number>; availability_ci_method?: string; evidence_status?: string; sla_breach_probability_ci95?: number[]; annual_sla_budget_minutes?: number; p99_annual_downtime_minutes?: number; worst_trial?: { trial_id: number; downtime_minutes: number; horizon_hours: number; timeline: TracePoint[] }; redundancy: string; trials_run: number; seed: number; simulated_years: number; availability_percent: number; availability_ci95: number[]; expected_annual_downtime_minutes: number; p95_annual_downtime_minutes: number; sla_target_percent: number; sla_breaches: number; sla_breach_rate_percent: number; meets_sla: boolean; outage_trials: number; outage_probability_ci95: number[]; service_survival_percent: number; overlap_trials: number; total_failure_events: number; expected_unserved_energy_kwh_per_year: number; worst_surviving_capacity_kw: number; infra_cost_index: number; component_count: number; convergence: {trials: number; availability: number; ci_low?: number; ci_high?: number; outage_trials?: number}[]; histogram: {range: string; trials: number}[]; failure_breakdown: {component: string; kind: string; failures: number}[]; sample_events: FailureEvent[]; trial_results: Trial[]; topology: Group[] }
export interface Rate { component: string; label: string; failure_rate_per_year: number; mttr_hours: number; status: string; source: string; source_url: string | null; notes: string }
export interface Run { diagnostics?: Diagnostics | null; paired_comparisons?: {baseline: string; alternative: string; downtime_reduction_minutes: number; ci95: number[]; nonzero_pairs: number; evidence_limited: boolean}[]; run_id: string; created_at: string; kind: 'comparison' | 'simulation'; config: Config; duration_seconds: number; results: Result[]; dataset_version: string; failure_rates: Rate[]; model_notes: string[]; engine_version: string }
export const number = (value: number, digits = 0) => value.toLocaleString('en-US', {maximumFractionDigits: digits, minimumFractionDigits: digits})
export const availability = (value: number) => value === 100 ? '100.0000' : value.toFixed(4)

export function configError(c: Config): string {
  if (!c.facility_name.trim()) return 'Enter a facility name.'
  const fields: [string, number, number, number][] = [
    ['IT load',c.it_load_kw,500,50000],['UPS capacity',c.power.ups_capacity_kw_each,100,50000],
    ['Generator capacity',c.power.generator_capacity_kw_each,100,100000],['PDU capacity',c.power.pdu_capacity_kw_each,100,50000],
    ['Cooling capacity',c.cooling.crac_capacity_kw_each,100,50000],['Trials',c.simulation.num_trials,100,20000],
    ['Years per trial',c.simulation.simulated_years_per_trial,1,5],['Random seed',c.simulation.seed,0,4294967295]]
  for (const [name,value,min,max] of fields) if (!Number.isFinite(value)||value<min||value>max) return `${name} must be between ${number(min)} and ${number(max)}.`
  if (![c.simulation.seed,c.simulation.num_trials,c.simulation.simulated_years_per_trial].every(Number.isInteger)) return 'Seed, trials and years must be whole numbers.'
  if (!Number.isInteger(c.it.server_nodes_required)||c.it.server_nodes_required<1||c.it.server_nodes_required>50) return 'Server nodes must be an integer from 1 to 50.'
  for (const [key,value] of Object.entries(c.budget)) if (!Number.isFinite(value)||value<0||value>(key.endsWith('_per_kw')?1000000:100000000)) return `Invalid budget input: ${key}.`
  const sim=c.simulation, m=c.maintenance
  for (const [name,value,min,max] of [['Common-cause probability',sim.common_cause_probability,0,1],['Surge opportunities/year',sim.common_cause_events_per_year,0,10],['Surge duration',sim.common_cause_duration_hours,0.000001,168],['Maintenance start',m.start_hour,0,43800],['Maintenance duration',m.duration_hours,0.000001,168]] as [string,number,number,number][]) if (!Number.isFinite(value)||value<min||value>max) return `${name} must be between ${min} and ${max}.`
  if (sim.failure_mode==='single'&&(sim.dependent_failures||m.enabled)) return 'Maintenance/dependent scenarios require overlapping failure mode.'
  if (m.enabled && m.start_hour+m.duration_hours>sim.simulated_years_per_trial*8760) return 'Maintenance window must fit inside the trial horizon.'
  if (m.enabled&&!maintenanceTargets(c).includes(m.component_id)) return 'Maintenance target must exist in the N baseline (A bank).'
  const work=workEstimate(c)
  if (work.components>160) return 'Design exceeds 160 comparison components. Increase unit capacity or reduce load/server nodes.'
  if (work.unitTrials>45000000) return `Experiment exceeds 45M weighted unit-trials. Maximum ${number(work.maxTrials)} trials at these settings.`
  return ''
}
export function workEstimate(c: Config) {
  const hardware=[c.power.ups_capacity_kw_each,c.power.generator_capacity_kw_each,c.power.pdu_capacity_kw_each,c.cooling.crac_capacity_kw_each,c.it_load_kw].reduce((n,capacity)=>n+2*Math.ceil(c.it_load_kw/capacity),0)
  const components=hardware+(c.it.enabled?2*(c.it.server_nodes_required+3):0)
  const weight=(components+(c.it.enabled?2*c.it.server_nodes_required:0))*c.simulation.simulated_years_per_trial*c.simulation.stress_multiplier
  return {components, unitTrials: weight*c.simulation.num_trials, maxTrials: Math.min(20000,Math.floor(45000000/weight))}
}
export function maintenanceTargets(c: Config) {
  const groups: [string,number][]=[['UPS',Math.ceil(c.it_load_kw/c.power.ups_capacity_kw_each)],['GEN',Math.ceil(c.it_load_kw/c.power.generator_capacity_kw_each)],['PDU',Math.ceil(c.it_load_kw/c.power.pdu_capacity_kw_each)],['ATS',1],['CRAC',Math.ceil(c.it_load_kw/c.cooling.crac_capacity_kw_each)]]
  if(c.it.enabled)groups.push(['SRV',c.it.server_nodes_required],['NET',1],['STO',1],['APP',1])
  return groups.flatMap(([prefix,n])=>Array.from({length: Math.min(160,Math.max(0,Number.isFinite(n)?n:0))},(_,i)=>`${prefix}-A${String(i+1).padStart(2,'0')}`))
}
export function normalizeConfig(c: Config): Config {
  return {...structuredClone(DEFAULT_CONFIG),...c, it: c.it??{...DEFAULT_CONFIG.it,enabled:false}, maintenance:{...DEFAULT_CONFIG.maintenance,...c.maintenance},budget:{...DEFAULT_CONFIG.budget,...c.budget},simulation:{...DEFAULT_CONFIG.simulation,...c.simulation}}
}
export const inr = (v: number) => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v)
