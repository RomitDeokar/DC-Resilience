import { Activity, ArrowRight, BatteryCharging, Check, CircuitBoard, Fuel, Info, LoaderCircle, RotateCcw, Server, Snowflake, Zap, X } from 'lucide-react'
import { number, type Config, type FacilityState, type Group } from './types'
const icons: Record<string, typeof Zap> = {UPS_MODULE: BatteryCharging, GENERATOR: Fuel, PDU: CircuitBoard, ATS: Zap, CRAC: Snowflake, SERVER: Server, NETWORK: CircuitBoard, STORAGE: Server, APPLICATION: Activity}
const labels: Record<string, string> = {UPS_MODULE:'UPS modules',GENERATOR:'Generators',PDU:'Power distribution',ATS:'Transfer switches',CRAC:'Cooling units',SERVER:'Server hardware + OS',NETWORK:'Network service',STORAGE:'Storage service',APPLICATION:'Application service'}
export function FacilityDiagram({state, config, failed = [], onToggle, compact = false, disabled=false, unavailable=false}: {state: FacilityState | null; config: Config; failed?: string[]; onToggle?: (id: string)=>void; compact?: boolean; disabled?: boolean; unavailable?: boolean}) {
  const count = state?.groups.reduce((a,g)=>a+g.components.length,0) || 0
  const lanes = [{id:'power',label:'Electrical',note:config.simulation.operating_mode==='islanded'?'Generator supply':'Ideal utility supply',kinds:['GENERATOR','ATS','UPS_MODULE','PDU']},{id:'cooling',label:'Mechanical',note:'Usable cooling capacity',kinds:['CRAC']},{id:'it',label:'IT services',note:'Representative workload',kinds:['SERVER','NETWORK','STORAGE','APPLICATION']}]
  return <section className={`facility-diagram single-line ${compact?'compact':''}`}>
    <div className="diagram-heading"><div><span className="eyebrow">DEPENDENCY SCHEMATIC</span><h3>{config.facility_name || 'Untitled facility'} <span className="dark-chip">SLA benchmark {config.tier_target}</span></h3></div><span className={`live-status ${state && !state.service_maintained?'failed':''}`}><i/>{state ? state.service_maintained?'Service maintained':'Capacity degraded':unavailable?'Invalid configuration':'Loading topology'}</span></div>
    {state?(hasTwoTrains(state)
      ? <TrainSchematic state={state} config={config} failed={failed} onToggle={onToggle} disabled={disabled}/>
      : <div className="schematic-lanes">{lanes.map(lane=>{
        const groups=lane.kinds.map(k=>state.groups.find(g=>g.kind===k)).filter((g):g is Group=>!!g)
        if(!groups.length)return null
        return <div className="schematic-lane" key={lane.id}><div className="lane-label"><strong>{lane.label}</strong><small>{lane.note}</small></div><div className="lane-stages">{groups.map(group=><Equipment key={group.kind} group={group} failed={failed} onToggle={onToggle} compact={compact} disabled={disabled}/>)}</div></div>
      })}<div className={`schematic-output ${!state.service_maintained?'degraded':''}`}><Server size={20}/><span>Delivered IT workload</span><strong>{number(Math.min(state.surviving_capacity_kw, config.it_load_kw))} <small>/ {number(config.it_load_kw)} kW</small></strong>{state.service_maintained?<Check size={17}/>:<Activity size={17}/>}</div></div>
      ):<div className="diagram-loading">{!unavailable&&<LoaderCircle className="spin"/>}{unavailable?'Fix the configuration to preview equipment':'Preparing facility topology'}</div>}
    <div className="diagram-footer"><span><i className="legend-dot green"/>Operational{onToggle&&<><i className="legend-dot red"/>Failed</>}<i className="legend-dot outlined"/>{count} components</span><span>{onToggle?'Select a numbered unit to fail or repair':'Grouped dependencies · not physical wiring'}</span></div>
  </section>
}
function Equipment({group, failed, onToggle, compact, disabled}: {group: Group; failed: string[]; onToggle?: (id: string)=>void; compact: boolean; disabled: boolean}) {
  const Icon=icons[group.kind]||Zap
  const broken=group.components.some(c=>failed.includes(c.id))
  return <div className={`line-stage ${broken?'has-failure':''}`}><div className="stage-symbol"><Icon size={22}/></div><h4>{labels[group.kind]||group.kind}</h4><p>{group.components.length} units <span>· {group.redundancy}</span></p>{!compact&&<div className="stage-units">{group.components.map(c=><button key={c.id} disabled={!onToggle||disabled} aria-label={`${failed.includes(c.id)?'Repair':'Fail'} ${c.id}`} title={`${c.id} · ${number(c.capacity_kw)} kW`} onClick={()=>onToggle?.(c.id)} className={failed.includes(c.id)?'unit-failed':''}>{c.id.replace(/^[^-]+-/, '')}</button>)}</div>}<small>{number(group.capacity_kw_each,1)} {group.subsystem==='it'?'workload-kW':'kW'} / unit</small></div>
}
function hasTwoTrains(state: FacilityState): boolean {
  return state.groups.some(g=>g.components.some(c=>c.bank==='B'))
}
// A/B train view: 2N's key idea is two complete, independent paths. Drawing them
// as parallel columns (never pooled boxes) makes the no-cross-tie rule visible.
function TrainSchematic({state, config, failed, onToggle, disabled}: {state: FacilityState; config: Config; failed: string[]; onToggle?: (id:string)=>void; disabled: boolean}) {
  const demand = config.it_load_kw || 1
  const served = Math.min(state.surviving_capacity_kw, demand)
  const unmet = Math.max(0, demand - served)
  const limiting = [...state.groups].sort((a,b)=>(a.surviving_capacity_kw??0)-(b.surviving_capacity_kw??0))[0]
  const powerKinds = ['GENERATOR','ATS','UPS_MODULE','PDU']
  const itKinds = ['SERVER','NETWORK','STORAGE','APPLICATION']
  const unitButton = (u: {id:string; capacity_kw:number}) => <button key={u.id} type="button" disabled={!onToggle||disabled} aria-label={`${failed.includes(u.id)?'Repair':'Fail'} ${u.id}`} title={`${u.id} · ${number(u.capacity_kw)} kW`} onClick={()=>onToggle?.(u.id)} className={failed.includes(u.id)?'unit-failed':''}>{u.id.replace(/^[^-]+-/,'')}</button>
  return <div className="train-view">
    <div className="train-grid">{(['A','B'] as const).map(bank=>{
      const stages = powerKinds.map(k=>state.groups.find(g=>g.kind===k)).filter((g):g is Group=>!!g)
        .map(g=>({group:g, units:g.components.filter(c=>c.bank===bank)})).filter(s=>s.units.length)
      const cooling = state.groups.find(g=>g.kind==='CRAC')?.components.filter(c=>c.bank===bank)??[]
      const itUnits = state.groups.filter(g=>itKinds.includes(g.kind)).flatMap(g=>g.components.filter(c=>c.bank===bank))
      const complete = stages.every(s=>s.units.some(u=>!failed.includes(u.id))) && (config.cooling.redundancy!=='2N'||cooling.some(u=>!failed.includes(u.id)))
      return <div className={`train-column ${complete?'ok':'down'}`} key={bank}>
        <div className="train-header"><strong>Train {bank}</strong><span className={`train-status ${complete?'ok':'down'}`}>{complete?'Complete':'Incomplete'}</span></div>
        <div className="train-chain">{stages.map(({group,units})=><div className="train-stage" key={group.kind}><span className="train-stage-label">{labels[group.kind]||group.kind}</span><div className="train-units">{units.map(unitButton)}</div></div>)}</div>
        {!!cooling.length&&<div className="train-stage"><span className="train-stage-label">{labels.CRAC}</span><div className="train-units">{cooling.map(unitButton)}</div></div>}
        {!!itUnits.length&&<div className="train-stage train-it"><span className="train-stage-label">IT services</span><div className="train-units">{itUnits.map(unitButton)}</div></div>}
      </div>
    })}</div>
    <div className={`train-load ${state.service_maintained?'':'degraded'}`}>
      <div className="train-load-nums"><span>Demand <b>{number(demand)} kW</b></span><span>Served <b>{number(served)} kW</b></span><span>Unmet <b className={unmet?'text-red':'text-green'}>{number(unmet)} kW</b></span><span>Limiting group <b>{labels[limiting?.kind]||limiting?.kind||'—'}</b></span></div>
      <div className="load-bar"><i style={{width:`${Math.min(100,served/demand*100)}%`,background:state.service_maintained?'var(--green)':'var(--red)'}}/></div>
      <small>No cross-ties: each train must be complete on its own; capacity is never pooled across trains.</small>
    </div>
  </div>
}
// Every recovery duration that a named scenario can select, plus the common holds.
// Including the sampled MTTR values keeps the control in sync with the actual hold.
function durationOptions(current: number): number[] {
  return Array.from(new Set([0.25, 0.5, 1, 1.64, 2, 3, 4, 5.5, 8, 24, 25.74, current])).sort((a, b) => a - b)
}
function formatDuration(h: number): string {
  if (h === 0.25) return '15 minutes'
  if (h === 0.5) return '30 minutes'
  return `${h} hour${h === 1 ? '' : 's'}`
}
export function FailureLab({config, state, failed, busy, onToggle, onReset, onScenario, logs, duration, onDuration, unavailable}: {duration: number; onDuration: (hours:number)=>void; unavailable: boolean; config: Config; state: FacilityState|null; failed: string[]; busy: boolean; onToggle: (id: string)=>void; onReset: ()=>void; onScenario: (s: string)=>void; logs: {time: string; text: string; healthy: boolean}[]}) {
  return <div className="lab-content">
    <div className="lab-prompt"><div className="prompt-icon"><Zap size={20}/></div><div><h3>Failure lab</h3><p>Click any unit to take it offline. Watch redundancy protect your IT load, or reach its limit.</p></div><button className="button" onClick={onReset} disabled={busy || !failed.length}><RotateCcw size={15}/>Restore all</button></div>
    <div className="scenario-bar"><span>QUICK SCENARIOS</span><button disabled={busy} onClick={()=>onScenario('single')}>Single UPS failure</button><button disabled={busy} onClick={()=>onScenario('double')}>Dual UPS failure</button><button disabled={busy} onClick={()=>onScenario('path')}>Power path A outage</button><button disabled={busy||config.power.redundancy!=='2N'} title="Requires 2N power" onClick={()=>onScenario('cross')}>Cross-path failure</button><button disabled={busy} onClick={()=>onScenario('cooling')}>Cooling capacity loss</button></div>
    {config.it.enabled&&<div className="scenario-bar"><span>IT SERVICE SCENARIOS</span>{[['server','Server hardware'],['os','OS / hypervisor crash'],['servers','Two server nodes'],['storage','All storage replicas'],['network','All network replicas'],['application','All application replicas']].map(([id,label])=><button key={id} disabled={busy} onClick={()=>onScenario(id)}>{label}</button>)}</div>}
    <div className="scenario-bar"><span>SHARED HAZARD</span><button disabled={busy} onClick={()=>onScenario('surge')}>Site-wide UPS + generator surge</button><small>Deterministic forced scenario. Use maintenance controls + Run simulation for timed maintenance.</small></div>
    <div className="lab-duration"><label htmlFor="duration">Hold failures for</label><select id="duration" disabled={busy} value={duration} onChange={e=>onDuration(Number(e.target.value))}>{durationOptions(duration).map(h=><option key={h} value={h}>{formatDuration(h)}</option>)}</select><span>Hypothetical hold · named scenarios use each cause&apos;s recovery time</span></div>
    <FacilityDiagram unavailable={unavailable} state={state} config={config} failed={failed} onToggle={onToggle} disabled={busy}/>
    <div className="lab-metrics"><div className="panel"><span>Surviving capacity</span><strong>{number(state?.surviving_capacity_kw || 0)}<small> kW</small></strong><div className="capacity-meter"><i style={{width:`${Math.min(100,(state?.surviving_capacity_kw || 0)/config.it_load_kw*100)}%`,background:state?.service_maintained?'var(--green)':'var(--red)'}}/></div><small>{number(config.it_load_kw)} kW required</small></div><div className="panel"><span>IT capacity lost</span><strong className={state?.lost_capacity_kw?'text-red':''}>{number(state?.lost_capacity_kw || 0)}<small> kW</small></strong><small>{number((state?.lost_capacity_kw || 0)/config.it_load_kw*100,1)}% of required IT load</small></div><div className="panel"><span>Active failures</span><strong>{failed.length}<small> units</small></strong><small>{failed.length===0?'All components operational':'Click failed units to restore them'}</small></div><div className="panel"><span>Scenario impact</span><strong className={state?.service_maintained?'text-green':'text-red'}>{!state?'Unavailable':state.service_maintained?'Protected':'Interrupted'}</strong><small>{!state?'No valid topology':state.service_maintained?'No IT service interruption':`${number(duration*60)} min downtime if held for ${duration} h`}</small></div></div>
    {state&&<div className="capacity-summary panel"><div><span>Usable power</span><strong>{number(state.power_capacity_kw)} kW</strong></div><div><span>Usable cooling</span><strong>{number(state.cooling_capacity_kw)} kW</strong></div><div><span>Usable IT workload</span><strong>{number(state.it_capacity_kw??config.it_load_kw)} workload-kW</strong></div><div><span>Unserved energy over {duration} h</span><strong>{number(state.lost_capacity_kw*duration,2)} kWh</strong></div><p>Service is the minimum of usable power, cooling and IT workload capacity. Each 2N train must be complete. OS crashes affect their host, not an independent pool; workload-kW is not server electrical draw.</p></div>}
    <div className="panel event-console"><div className="panel-heading"><h3><Activity size={16}/> Injection event log</h3><span className="subtle">Current session</span></div><div className="console-body">{logs.length?logs.slice(0,12).map((log,i)=><div key={i}><span className="mono">{log.time}</span><span className={log.healthy?'console-ok':'console-fail'}>{log.healthy?'PROTECTED':'DEGRADED'}</span><span>{log.text}</span></div>):<div><span className="mono">READY</span><span className="console-ok">HEALTHY</span><span>Facility initialized. Select a scenario or click a component to begin.</span></div>}</div></div>
    <div className="inline-note"><Info size={15}/><span>Deterministic live injection, not a Monte Carlo forecast. Failures persist until repaired. Named scenarios force component states; OS and hardware buttons have the same host-capacity effect. The Monte Carlo engine separately samples both causes. No thermal-delay or full software stack model.</span></div>
  </div>
}
