import { useState } from 'react'
import { SlidersHorizontal, RotateCcw, ChevronDown, Zap, Snowflake, FlaskConical, Play, Info, LoaderCircle } from 'lucide-react'
import { DEFAULT_CONFIG, TIERS, number, type Config, type Redundancy } from './types'

export function ConfigPanel({config, setConfig, busy, onRun, compare = false}: {config: Config; setConfig: (c: Config) => void; busy: boolean; onRun: () => void; compare?: boolean}) {
  const [advanced, setAdvanced] = useState(false)
  const update = (key: keyof Config, value: unknown) => setConfig({...config, [key]: value})
  const sim = (key: string, value: unknown) => update('simulation', {...config.simulation, [key]: value})
  const redundancy = (type: 'power' | 'cooling', value: Redundancy) => update(type, {...config[type], redundancy: value})
  return <aside className="config-panel panel">
    <div className="panel-heading"><h3><SlidersHorizontal size={16}/> Facility configuration</h3><button type="button" className="icon-button" title="Reset configuration" aria-label="Reset configuration" onClick={() => setConfig(structuredClone(DEFAULT_CONFIG))} disabled={busy}><RotateCcw size={15}/></button></div>
    <form onSubmit={e => {e.preventDefault(); onRun()}}>
      <fieldset disabled={busy}>
        <div className="config-section">
          <label htmlFor="facility">Facility name</label><input id="facility" required maxLength={80} value={config.facility_name} onChange={e => update('facility_name', e.target.value)}/>
          <label htmlFor="tier">Target tier <span className="field-help" title="Historical availability benchmark, not a Tier certification"><Info size={13}/></span></label>
          <div className="select-wrap"><select id="tier" value={config.tier_target} onChange={e => update('tier_target', e.target.value)}>{Object.entries(TIERS).map(([tier, target]) => <option key={tier} value={tier}>Tier {tier} · {target}%</option>)}</select><ChevronDown size={14}/></div>
          <div className="label-row"><label htmlFor="load">IT load</label><span className="unit-label">kW</span></div>
          <input id="load" type="number" min={500} max={50000} step={100} required value={config.it_load_kw} onChange={e => update('it_load_kw', Number(e.target.value))}/>
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
        <div className="config-section simulation-config">
          <h4><FlaskConical size={15}/> Simulation parameters</h4>
          <div className="two-fields"><div><label htmlFor="trials">Trials</label><div className="select-wrap"><select id="trials" value={config.simulation.num_trials} onChange={e => sim('num_trials',Number(e.target.value))}>{[100,1000,5000,10000,20000].map(n => <option key={n} value={n}>{number(n)}</option>)}</select><ChevronDown size={13}/></div></div><div><label htmlFor="years">Years / trial</label><div className="select-wrap"><select id="years" value={config.simulation.simulated_years_per_trial} onChange={e => sim('simulated_years_per_trial',Number(e.target.value))}>{[1,2,3,5].map(n=><option key={n} value={n}>{n} {n===1?'year':'years'}</option>)}</select><ChevronDown size={13}/></div></div></div>
          <label htmlFor="failure-mode">Failure mode</label><div className="select-wrap"><select id="failure-mode" value={config.simulation.failure_mode} onChange={e => sim('failure_mode',e.target.value)}><option value="overlapping">Simultaneous failures</option><option value="single">Single failures only</option></select><ChevronDown size={13}/></div>
          <button type="button" className="advanced-toggle" onClick={()=>setAdvanced(!advanced)} aria-expanded={advanced}>Advanced settings<ChevronDown size={14} className={advanced?'rotate':''}/></button>
          {advanced && <div className="advanced-fields">
            <div className="two-fields"><div><label htmlFor="seed">Random seed</label><input id="seed" type="number" min={0} max={4294967295} required value={config.simulation.seed} onChange={e=>sim('seed',Number(e.target.value))}/></div><div><label htmlFor="stress">Failure stress</label><select id="stress" value={config.simulation.stress_multiplier} onChange={e=>sim('stress_multiplier',Number(e.target.value))}><option value="1">1× baseline</option><option value="5">5× stress</option><option value="20">20× stress</option></select></div></div>
            <label htmlFor="operating-mode">Operating scenario</label><select id="operating-mode" value={config.simulation.operating_mode} onChange={e=>sim('operating_mode',e.target.value)}><option value="islanded">Islanded · generator powered</option><option value="utility">Utility · ideal grid available</option></select>
            {([['ups_capacity_kw_each','UPS unit kW'],['generator_capacity_kw_each','Generator unit kW'],['pdu_capacity_kw_each','PDU unit kW']] as const).map(([key,label])=><div key={key}><label htmlFor={key}>{label}</label><input id={key} type="number" min={100} max={50000} required value={config.power[key]} onChange={e=>update('power',{...config.power,[key]:Number(e.target.value)})}/></div>)}
            <label htmlFor="crac-capacity">Cooling unit kW</label><input id="crac-capacity" type="number" min={100} max={50000} required value={config.cooling.crac_capacity_kw_each} onChange={e=>update('cooling',{...config.cooling,crac_capacity_kw_each:Number(e.target.value)})}/>
          </div>}
        </div>
      </fieldset>
      <div className="config-footer"><button className="button primary run-button" type="submit" disabled={busy}>{busy?<LoaderCircle size={16} className="spin"/>:<Play size={15} fill="currentColor"/>}{busy?'Running experiment…':compare?'Compare architectures':'Run simulation'}</button><span className="run-caption">{number(config.simulation.num_trials)} trials {compare?'× 3 architectures':'· Reproducible by seed'}</span></div>
    </form>
  </aside>
}
