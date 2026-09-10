export type Redundancy = 'N' | 'N+1' | '2N'
export type Page = 'simulation' | 'lab' | 'comparison' | 'history' | 'references' | 'methodology'
export interface Config {
  facility_name: string; tier_target: 'I' | 'II' | 'III' | 'IV'; it_load_kw: number;
  power: { redundancy: Redundancy; ups_capacity_kw_each: number; generator_capacity_kw_each: number; pdu_capacity_kw_each: number };
  cooling: { redundancy: Redundancy; crac_capacity_kw_each: number };
  simulation: { num_trials: number; simulated_years_per_trial: number; seed: number; failure_mode: 'single' | 'overlapping'; stress_multiplier: 1 | 5 | 20; operating_mode: 'islanded' | 'utility' }
}
export const DEFAULT_CONFIG: Config = { facility_name: 'SRM Research Facility', tier_target: 'III', it_load_kw: 10000,
  power: { redundancy: 'N+1', ups_capacity_kw_each: 2500, generator_capacity_kw_each: 5000, pdu_capacity_kw_each: 2500 },
  cooling: { redundancy: 'N+1', crac_capacity_kw_each: 2000 },
  simulation: { num_trials: 10000, simulated_years_per_trial: 1, seed: 42, failure_mode: 'overlapping', stress_multiplier: 1, operating_mode: 'islanded' } }
export const TIERS = { I: 99.671, II: 99.741, III: 99.982, IV: 99.995 }
export interface Component { id: string; bank: string; capacity_kw: number; kind: string }
export interface Group { kind: string; short: string; subsystem: string; redundancy: Redundancy; required_units: number; capacity_kw_each: number; components: Component[]; surviving_capacity_kw?: number; healthy_units?: number }
export interface FacilityState { groups: Group[]; surviving_capacity_kw: number; power_capacity_kw: number; cooling_capacity_kw: number; required_capacity_kw: number; lost_capacity_kw: number; service_maintained: boolean; failed_components: string[]; downtime_minutes?: number; duration_hours?: number; unserved_energy_kwh?: number }
export interface FailureEvent { component: string; kind: string; time_hours: number; duration_hours: number; active_failures: number; surviving_capacity_kw: number; service_maintained: boolean; trial_id: number }
export interface Trial { trial_id: number; availability_percent: number; annual_downtime_minutes: number; service_maintained: boolean; minimum_capacity_kw: number }
export interface TracePoint { time_hours: number; action: string; component: string; surviving_capacity_kw: number; served_it_kw: number; power_capacity_kw: number; cooling_capacity_kw: number; failed_components: string[]; service_maintained: boolean }
export interface Result { availability_ci_method?: string; evidence_status?: string; sla_breach_probability_ci95?: number[]; annual_sla_budget_minutes?: number; p99_annual_downtime_minutes?: number; worst_trial?: { trial_id: number; downtime_minutes: number; horizon_hours: number; timeline: TracePoint[] }; redundancy: string; trials_run: number; seed: number; simulated_years: number; availability_percent: number; availability_ci95: number[]; expected_annual_downtime_minutes: number; p95_annual_downtime_minutes: number; sla_target_percent: number; sla_breaches: number; sla_breach_rate_percent: number; meets_sla: boolean; outage_trials: number; outage_probability_ci95: number[]; service_survival_percent: number; overlap_trials: number; total_failure_events: number; expected_unserved_energy_kwh_per_year: number; worst_surviving_capacity_kw: number; infra_cost_index: number; component_count: number; convergence: {trials: number; availability: number}[]; histogram: {range: string; trials: number}[]; failure_breakdown: {component: string; kind: string; failures: number}[]; sample_events: FailureEvent[]; trial_results: Trial[]; topology: Group[] }
export interface Rate { component: string; label: string; failure_rate_per_year: number; mttr_hours: number; status: string; source: string; source_url: string | null; notes: string }
export interface Run { paired_comparisons?: {baseline: string; alternative: string; downtime_reduction_minutes: number; ci95: number[]; nonzero_pairs: number; evidence_limited: boolean}[]; run_id: string; created_at: string; kind: 'comparison' | 'simulation'; config: Config; duration_seconds: number; results: Result[]; dataset_version: string; failure_rates: Rate[]; model_notes: string[]; engine_version: string }
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
  const components = [c.power.ups_capacity_kw_each,c.power.generator_capacity_kw_each,c.power.pdu_capacity_kw_each,c.cooling.crac_capacity_kw_each,c.it_load_kw].reduce((n,capacity)=>n+2*Math.ceil(c.it_load_kw/capacity),0)
  if (components>160) return 'Design exceeds 160 comparison components. Increase unit capacity or reduce load.'
  if (components*c.simulation.num_trials*c.simulation.simulated_years_per_trial*c.simulation.stress_multiplier>45000000) return 'Experiment too large. Reduce trials, years, failure stress or component count.'
  return ''
}
