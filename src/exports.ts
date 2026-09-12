import type { Run } from './types'
export function download(data: string, name: string, type: string) {
  const blob = new Blob([data], { type }); const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function csvCell(value: unknown) {
  let s = String(value ?? '')
  // Keep numeric deltas numeric; neutralize formulas even behind whitespace.
  if (typeof value === 'string' && (/^\s*[=+@\-]/.test(s) || /^[\t\r\n]/.test(s))) s = `'${s}`
  return `"${s.replaceAll('"', '""')}"`
}
export function exportRun(run: Run, format: 'json' | 'csv' | 'trials') {
  const prefix = `DC_Resilience_${run.kind}_${run.run_id.slice(0,8)}`
  if (format === 'json') return download(JSON.stringify(run, null, 2), `${prefix}.json`, 'application/json')
  const rows: unknown[][] = format === 'trials'
    ? [['run_id','architecture','trial_id','availability_percent','annual_downtime_minutes','service_maintained','minimum_capacity_kw','seed','dataset_version','engine_version'], ...run.results.flatMap(r => r.trial_results.map(t => [run.run_id,r.redundancy,t.trial_id,t.availability_percent,t.annual_downtime_minutes,t.service_maintained,t.minimum_capacity_kw,run.config.simulation.seed,run.dataset_version,run.engine_version]))]
    : [['run_id','facility','architecture','trials','years_per_trial','IT_load_kw','availability_percent','ci95_low','ci95_high','annual_downtime_minutes','sla_breaches','sla_breach_rate_percent','infra_cost_index','seed','failure_mode','stress_multiplier','operating_mode','dataset_version','ci_method','evidence_status','outage_risk_ci95_low','outage_risk_ci95_high','sla_risk_ci95_low','sla_risk_ci95_high','unserved_energy_kwh_per_year','planning_inr','config_json','effective_rates_json','maintenance_json','diagnostics_json','model_notes_json','engine_version','scenario_incidents_json','data_warning'], ...run.results.map(r => [run.run_id,run.config.facility_name,r.redundancy,r.trials_run,run.config.simulation.simulated_years_per_trial,run.config.it_load_kw,r.availability_percent,...r.availability_ci95,r.expected_annual_downtime_minutes,r.sla_breaches,r.sla_breach_rate_percent,r.infra_cost_index,run.config.simulation.seed,run.config.simulation.failure_mode,run.config.simulation.stress_multiplier,run.config.simulation.operating_mode,run.dataset_version,r.availability_ci_method||'legacy-normal',r.evidence_status||'legacy',...r.outage_probability_ci95,...(r.sla_breach_probability_ci95||['','']),r.expected_unserved_energy_kwh_per_year,r.budget?.total_inr??'',JSON.stringify(run.config),JSON.stringify(r.effective_rates??{}),JSON.stringify(r.maintenance??null),JSON.stringify(run.diagnostics??null),JSON.stringify(run.model_notes),run.engine_version,JSON.stringify(r.scenario_incidents??{}),'Mixed cited and illustrative data; not publication-ready'])]
  download('\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), `${prefix}_${format}.csv`, 'text/csv;charset=utf-8')
}
export async function saveRun(run: Run) {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => { const tx = db.transaction('runs', 'readwrite'); tx.objectStore('runs').put(run); tx.oncomplete = () => {db.close(); resolve()}; tx.onerror = () => {db.close(); reject(tx.error)} })
}
export async function loadRuns(): Promise<Run[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => { const tx = db.transaction('runs', 'readonly'); const r = tx.objectStore('runs').getAll(); r.onsuccess = () => {db.close(); resolve((r.result as Run[]).sort((a,b) => b.created_at.localeCompare(a.created_at)))}; r.onerror = () => {db.close(); reject(r.error)} })
}
export async function deleteRun(id: string) {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => { const tx = db.transaction('runs', 'readwrite'); tx.objectStore('runs').delete(id); tx.oncomplete = () => {db.close(); resolve()}; tx.onerror = () => {db.close(); reject(tx.error)} })
}
function openDB(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const r = indexedDB.open('dc-resilience', 1); r.onupgradeneeded = () => { r.result.createObjectStore('runs', {keyPath: 'run_id'}) }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) }) }
