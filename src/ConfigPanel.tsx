import { useState } from 'react'
import { SlidersHorizontal, RotateCcw, ChevronDown, Zap, Snowflake, FlaskConical, Play, Info, LoaderCircle } from 'lucide-react'
import { DEFAULT_CONFIG, TIERS, number, configError, workEstimate, maintenanceTargets, type Config, type Redundancy } from './types'

export function ConfigPanel({config, setConfig, busy, onRun, compare = false}: {config: Config; setConfig: (c: Config) => void; busy: boolean; onRun: () => void; compare?: boolean}) {
  const [advanced, setAdvanced] = useState(false)
  const validation = configError(config)
  const work = workEstimate(config)
  function preset(value: string) {
    if (!value) return
    const next = structuredClone(DEFAULT_CONFIG)
    if (value === 'quick') next.simulation.num_trials = 1000
    if (value === 'stress') { next.simulation.num_trials = 1000; next.simulation.stress_multiplier = 20 }
    if (value === 'single') next.simulation.failure_mode = 'single'
    if (value === 'paths') next.power.redundancy = next.cooling.redundancy = next.it.redundancy = '2N'
    if (value === 'dependent') {next.simulation.num_trials=1000; next.simulation.dependent_failures=true; next.simulation.common_cause_scope='site'}
    if (value === 'maintenance') {next.simulation.num_trials=1000; next.maintenance.enabled=true; next.maintenance.inject_failure=true}
    if (value === 'diagnostics') {next.simulation.num_trials=1000; next.simulation.diagnostics=true; next.power.redundancy=next.cooling.redundancy=next.it.redundancy='N'}
    setConfig(next)
  }
  const update = (key: keyof Config, value: unknown) => setConfig({...config, [key]: value})
  const sim = (key: string, value: unknown) => update('simulation', {...config.simulation, [key]: value})
  const redundancy = (type: 'power' | 'cooling' | 'it', value: Redundancy) => update(type, {...config[type], redundancy: value})
  return <aside className="config-panel panel">
    <div className="panel-heading"><h3><SlidersHorizontal size={16}/> Facility configuration</h3><button type="button" className="icon-button" title="Reset configuration" aria-label="Reset configuration" onClick={() => setConfig(structuredClone(DEFAULT_CONFIG))} disabled={busy}><RotateCcw size={15}/></button></div>
    <form onSubmit={e => {e.preventDefault(); onRun()}}>
      <fieldset disabled={busy}>
        <div className="preset-section"><label htmlFor="preset">DEMO STARTING POINT</label><select id="preset" value="" onChange={e=>preset(e.target.value)}><option value="">Load a preset…</option><option value="quick">Quick check · 1,000 trials</option><option value="baseline">Research baseline · 10,000 trials</option><option value="stress">Overlap stress demo · 20× hazards</option><option value="single">Single-failure protection</option><option value="paths">Independent paths · 2N</option><option value="dependent">Site common-cause · 1,000 trials</option><option value="maintenance">Maintenance + forced fault · 1,000</option><option value="diagnostics">Sensitivity & dependencies · N baseline</option></select><small>Presets reset all fields. Results update only when you run.</small></div>
        <div className="config-section">
          <label htmlFor="facility">Facility name</label><input id="facility" required maxLength={80} value={config.facility_name} onChange={e => update('facility_name', e.target.value)}/>
          <label htmlFor="tier">Target tier <span className="field-help" title="Historical availability benchmark, not a Tier certification"><Info size={13}/></span></label>
          <div className="select-wrap"><select id="tier" value={config.tier_target} onChange={e => update('tier_target', e.target.value)}>{Object.entries(TIERS).map(([tier, target]) => <option key={tier} value={tier}>Tier {tier} · {target}%</option>)}</select><ChevronDown size={14}/></div>
          <div className="label-row"><label htmlFor="load">IT load</label><span className="unit-label">kW</span></div>
          <input id="load" type="number" min={500} max={50000} step="any" required value={config.it_load_kw} onChange={e => update('it_load_kw', Number(e.target.value))}/>
          <input aria-label="IT load slider" className="range" type="range" min={500} max={50000} step={500} value={config.it_load_kw} style={{'--range': `${(config.it_load_kw-500)/495}%`} as React.CSSProperties} onChange={e => update('it_load_kw', Number(e.target.value))}/>
          <div className="range-labels"><span>500 kW</span><span>50,000 kW</span></div>
        </div>
        <div className="config-section">
          <h4><Zap size={15}/> Power redundancy</h4>
          <div className="segmented" role="group" aria-label="Power redundancy">{(['N','N+1','2N'] as Redundancy[]).map(r => <button key={r} type="button" disabled={compare} aria-pressed={config.power.redundancy===r} className={config.power.redundancy===r?'selected':''} onClick={() => redundancy('power',r)}>{r}</button>)}</div>
          <p className="field-caption">{compare ? 'All three architectures will be compared.' : config.power.redundancy === 'N+1' ? 'One additional unit per power group.' : config.power.redundancy === '2N' ? 'Two independent, full-capacity power paths.' : 'Required capacity. No spare units.'}</p>
          <h4 className="cooling-label"><Snowflake size={15}/> Cooling redundancy</h4>
          <div className="segmented" role="group" aria-label="Cooling redundancy">{(['N','N+1','2N'] as Redundancy[]).map(r => <button key={r} type="button" disabled={compare} aria-pressed={config.cooling.redundancy===r} className={config.cooling.redundancy===r?'selected':''} onClick={() => redundancy('cooling',r)}>{r}</button>)}</div>
        </div>
        <div className="config-section">
          <h4>Servers & IT services</h4>
          <label className="check-label"><input type="checkbox" checked={config.it.enabled} onChange={e=>update('it',{...config.it,enabled:e.target.checked})}/>Include IT service failures</label>
          {config.it.enabled&&<><label htmlFor="server-nodes">Required representative server nodes</label><input id="server-nodes" type="number" min={1} max={50} step={1} value={config.it.server_nodes_required} onChange={e=>update('it',{...config.it,server_nodes_required:Number(e.target.value)})}/>
          <div className="segmented" role="group" aria-label="IT redundancy">{(['N','N+1','2N'] as Redundancy[]).map(r=><button key={r} type="button" disabled={compare} aria-pressed={config.it.redundancy===r} className={config.it.redundancy===r?'selected':''} onClick={()=>redundancy('it',r)}>{r}</button>)}</div>
          <p className="field-caption">Hardware + OS/hypervisor, network, storage and application replicas. Equal workload shares, not physical server electrical ratings. All IT rates are illustrative.</p></>}
        </div>
        <div className="config-section simulation-config">
          <h4><FlaskConical size={15}/> Simulation parameters</h4>
          <div className="two-fields"><div><label htmlFor="trials">Trials</label><div className="select-wrap"><select id="trials" value={config.simulation.num_trials} onChange={e => sim('num_trials',Number(e.target.value))}>{[100,1000,5000,10000,20000].map(n => <option key={n} value={n}>{number(n)}</option>)}</select><ChevronDown size={13}/></div></div><div><label htmlFor="years">Years / trial</label><div className="select-wrap"><select id="years" value={config.simulation.simulated_years_per_trial} onChange={e => sim('simulated_years_per_trial',Number(e.target.value))}>{[1,2,3,5].map(n=><option key={n} value={n}>{n} {n===1?'year':'years'}</option>)}</select><ChevronDown size={13}/></div></div></div>
          <label htmlFor="failure-mode">Failure mode</label><div className="select-wrap"><select id="failure-mode" value={config.simulation.failure_mode} onChange={e => sim('failure_mode',e.target.value)}><option value="overlapping">Independent failures + overlaps</option><option value="single">Single failures only</option></select><ChevronDown size={13}/></div>
          <button type="button" className="advanced-toggle" onClick={()=>setAdvanced(!advanced)} aria-expanded={advanced}>Advanced settings<ChevronDown size={14} className={advanced?'rotate':''}/></button>
          {advanced && <div className="advanced-fields">
            <div className="two-fields"><div><label htmlFor="seed">Random seed</label><input id="seed" type="number" min={0} max={4294967295} required value={config.simulation.seed} onChange={e=>sim('seed',Number(e.target.value))}/></div><div><label htmlFor="stress">Failure stress</label><select id="stress" value={config.simulation.stress_multiplier} onChange={e=>sim('stress_multiplier',Number(e.target.value))}><option value="1">1× baseline</option><option value="5">5× stress</option><option value="20">20× stress</option></select></div></div>
            <label htmlFor="generator-basis">Generator source interpretation</label><select id="generator-basis" value={config.simulation.generator_rate_basis} onChange={e=>sim('generator_rate_basis',e.target.value)}><option value="published">Printed rate · 0.58 / year</option><option value="count_exposure">115 ÷ 266 · 0.43233 / year</option></select><p className="field-caption">Conflicting source values; neither is independently verified. Operating failure only, not failure-to-start.</p>
            <label htmlFor="operating-mode">Operating scenario</label><select id="operating-mode" value={config.simulation.operating_mode} onChange={e=>sim('operating_mode',e.target.value)}><option value="islanded">Islanded · generator powered</option><option value="utility">Utility · ideal grid available</option></select>
            {([['ups_capacity_kw_each','UPS unit kW'],['generator_capacity_kw_each','Generator unit kW'],['pdu_capacity_kw_each','PDU unit kW']] as const).map(([key,label])=><div key={key}><label htmlFor={key}>{label}</label><input id={key} type="number" min={100} max={key==='generator_capacity_kw_each'?100000:50000} step="any" required value={config.power[key]} onChange={e=>update('power',{...config.power,[key]:Number(e.target.value)})}/></div>)}
            <label htmlFor="crac-capacity">Cooling unit kW</label><input id="crac-capacity" type="number" step="any" min={100} max={50000} required value={config.cooling.crac_capacity_kw_each} onChange={e=>update('cooling',{...config.cooling,crac_capacity_kw_each:Number(e.target.value)})}/>
          </div>}
        </div>
        <details className="config-section scenario-settings"><summary>Dependency & maintenance experiments</summary>
          <label className="check-label"><input type="checkbox" checked={config.simulation.dependent_failures} onChange={e=>update('simulation',{...config.simulation,dependent_failures:e.target.checked,failure_mode:'overlapping'})}/>Add common-cause failures</label>
          <label htmlFor="cause-prob">Damage probability per surge opportunity</label><input id="cause-prob" type="number" min={0} max={1} step={.01} value={config.simulation.common_cause_probability} onChange={e=>sim('common_cause_probability',Number(e.target.value))}/>
          <label htmlFor="cause-rate">Surge opportunities / year (not stress-scaled)</label><input id="cause-rate" type="number" min={0} max={10} step={.1} value={config.simulation.common_cause_events_per_year} onChange={e=>sim('common_cause_events_per_year',Number(e.target.value))}/>
          <label htmlFor="cause-duration">Common-cause repair duration (hours)</label><input id="cause-duration" type="number" min={.001} max={168} step="any" value={config.simulation.common_cause_duration_hours} onChange={e=>sim('common_cause_duration_hours',Number(e.target.value))}/>
          <label htmlFor="cause-scope">Affected UPS + generator units</label><select id="cause-scope" value={config.simulation.common_cause_scope} onChange={e=>sim('common_cause_scope',e.target.value)}><option value="bank">All units in bank A</option><option value="site">All units across A and B</option></select>
          <p className="field-caption">Adds a shared surge hazard, not a correlation coefficient. Default 10% is an assumption, not a literature-measured value.</p>
          <label className="check-label"><input type="checkbox" checked={config.maintenance.enabled} onChange={e=>setConfig({...config,maintenance:{...config.maintenance,enabled:e.target.checked},simulation:{...config.simulation,failure_mode:'overlapping'}})}/>Scheduled maintenance</label>
          {config.maintenance.enabled&&<><label htmlFor="maintenance-target">Unit offline (present in all designs)</label><select id="maintenance-target" value={config.maintenance.component_id} onChange={e=>update('maintenance',{...config.maintenance,component_id:e.target.value})}>{maintenanceTargets(config).map(id=><option key={id}>{id}</option>)}</select>
          <label htmlFor="maintenance-start">Start hour</label><input id="maintenance-start" type="number" min={0} max={43800} step="any" value={config.maintenance.start_hour} onChange={e=>update('maintenance',{...config.maintenance,start_hour:Number(e.target.value)})}/>
          <label htmlFor="maintenance-duration">Maintenance duration (hours)</label><input id="maintenance-duration" type="number" min={.001} max={168} step="any" value={config.maintenance.duration_hours} onChange={e=>update('maintenance',{...config.maintenance,duration_hours:Number(e.target.value)})}/>
          <label className="check-label"><input type="checkbox" checked={config.maintenance.inject_failure} onChange={e=>update('maintenance',{...config.maintenance,inject_failure:e.target.checked})}/>Force a random same-group companion fault</label><p className="field-caption">One window per trial. Forced fault = conditional stress test, not annual field reliability. A peer must exist; maintenance + fault is stronger than Tier III maintenance alone.</p></>}
        </details>
        <div className="config-section"><label className="check-label"><input type="checkbox" checked={config.simulation.diagnostics} onChange={e=>sim('diagnostics',e.target.checked)}/>Run sensitivity & dependency diagnostics</label><p className="field-caption">Actual ±50% rate reruns with paired 95% intervals. Up to 1,000 trials per rerun; selected architecture, no maintenance, overlapping mode. Adds runtime; not computed for each comparison architecture.</p></div>
        <details className="config-section scenario-settings"><summary>Editable INR planning budget</summary><p className="field-caption">Educational assumptions—not market prices or vendor quotations. Excludes tax, installation, OPEX and software licensing.</p>{Object.entries(config.budget).map(([key,value])=><div key={key}><label htmlFor={`budget-${key}`}>{key.replaceAll('_',' ')}</label><input id={`budget-${key}`} type="number" min={0} max={key.endsWith('_per_kw')?1000000:100000000} step="any" value={value} onChange={e=>update('budget',{...config.budget,[key]:Number(e.target.value)})}/></div>)}</details>
      </fieldset>
      <div className="config-footer"><div className="work-budget"><b>Compute preflight</b><span>{number(work.components)} max components · {number(work.unitTrials/1000000,2)} / 45M weighted unit-trials</span><progress max={45000000} value={Math.min(45000000,work.unitTrials)}/><small>Safe trial ceiling: {number(work.maxTrials)}. Two simultaneous jobs; a third receives a retry message.</small>{work.maxTrials>=100&&work.unitTrials>45000000&&<button type="button" className="button" onClick={()=>sim('num_trials',Math.max(100,[100,1000,5000,10000,20000].filter(n=>n<=work.maxTrials).at(-1)??100))}>Reduce to a safe trial count</button>}</div>{validation&&<p className="validation-message" role="alert">{validation}</p>}{config.maintenance.enabled&&config.maintenance.inject_failure&&<p className="stress-label">CONDITIONAL MAINTENANCE STRESS · not an annual forecast</p>}{config.simulation.stress_multiplier>1&&<p className="stress-label">{config.simulation.stress_multiplier}× STRESS EXPERIMENT · not baseline reliability</p>}<button className="button primary run-button" type="submit" disabled={busy||!!validation}>{busy?<LoaderCircle size={16} className="spin"/>:<Play size={15} fill="currentColor"/>}{busy?'Running experiment…':compare?'Compare architectures':'Run simulation'}</button><span className="run-caption">{number(config.simulation.num_trials)} trials {compare?'× 3 architectures':'· Reproducible by seed'}</span></div>
    </form>
  </aside>
}
