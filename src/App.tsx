import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Database, Download, FileJson, FileSpreadsheet, FlaskConical, FolderOpen, GitCompareArrows, History, Info, LayoutDashboard, LoaderCircle, Menu, Play, Plus, Printer, Search, ShieldCheck, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { ConfigPanel } from './ConfigPanel'
import { FacilityDiagram, FailureLab } from './Visualizer'
import { ResultsDashboard, Comparison } from './Analytics'
import { References, Methodology } from './Reference'
import { api } from './api'
import { deleteRun, exportRun, loadRuns, saveRun } from './exports'
import { availability, DEFAULT_CONFIG, number, configError, normalizeConfig, inr, type Config, type FacilityState, type Page, type Rate, type Run, type Progress } from './types'

const NAV = [{id:'simulation',label:'Simulation workspace',icon:LayoutDashboard},{id:'lab',label:'Live failure lab',icon:Zap},{id:'comparison',label:'Architecture comparison',icon:GitCompareArrows},{id:'history',label:'Run history',icon:History}] as const
const TITLES: Record<Page,[string,string]> = {simulation:['Simulation workspace','Turn redundancy decisions into measurable reliability.'],lab:['Live failure lab','Explore what happens when your infrastructure fails.'],comparison:['Architecture comparison','Compare N, N+1 and 2N under identical conditions.'],history:['Run history','Your experiments, saved locally and ready to revisit.'],references:['Reference library','Traceable failure data. Clearly stated assumptions.'],methodology:['Methodology','An open, reproducible approach to reliability engineering.']}
function getPage(): Page { const p=location.hash.slice(1); return ['simulation','lab','comparison','history','references','methodology'].includes(p)?p as Page:'simulation' }

export default function App() {
  const [page,setPage] = useState<Page>(getPage)
  const [config,setConfig] = useState<Config>(structuredClone(DEFAULT_CONFIG))
  const [run,setRun] = useState<Run|null>(null)
  const [comparison,setComparison] = useState<Run|null>(null)
  const [history,setHistory] = useState<Run[]>([])
  const [rates,setRates] = useState<Rate[]>([])
  const [state,setState] = useState<FacilityState|null>(null)
  const [busy,setBusy] = useState(false)
  const [labBusy,setLabBusy] = useState(false)
  const [topologyBusy,setTopologyBusy] = useState(true)
  const [elapsed,setElapsed] = useState(0)
  const [jobId,setJobId] = useState<string|null>(null)
  const [progress,setProgress] = useState<Progress|null>(null)
  const [progressConnected,setProgressConnected] = useState(false)
  const [duration,setDuration] = useState(4)
  const [topologyError,setTopologyError] = useState('')
  const runLock = useRef(false)
  const labLock = useRef(false)
  const configVersion = useRef(0)
  const [failed,setFailed] = useState<string[]>([])
  const [logs,setLogs] = useState<{time:string;text:string;healthy:boolean}[]>([])
  const [error,setError] = useState('')
  const [toast,setToast] = useState('')
  const [health,setHealth] = useState(false)
  const [mobileOpen,setMobileOpen] = useState(false)
  const [showExport,setShowExport] = useState(false)
  const [showGuide,setShowGuide] = useState(false)
  const [showReport,setShowReport] = useState(false)
  const [reportRun,setReportRun] = useState<Run|null>(null)
  const started = useRef(false)
  const activeRun = page==='comparison'?comparison:run
  const stale = activeRun && JSON.stringify(config)!==JSON.stringify(activeRun.config)
  const nav = (p: Page) => {location.hash=p; setPage(p);setMobileOpen(false);setShowExport(false);window.scrollTo({top:0,behavior:'smooth'})}

  async function execute(compare=false, cfg=config, changePage=true) {
    if(runLock.current||labLock.current) return
    const invalid = configError(cfg)
    if(invalid) {setError(invalid);return}
    runLock.current=true
    setBusy(true);setElapsed(0);setError('');setShowExport(false);setProgress(null);setProgressConnected(false)
    if(changePage) nav(compare?'comparison':'simulation')
    try {
      const plan=await api<{total_trial_evaluations:number}>(`preflight?compare=${compare}`,cfg)
      const id=crypto.randomUUID()
      setProgress({completed_trials:0,total_trials:plan.total_trial_evaluations,phase:'Starting engine'})
      setJobId(id)
      const data=await api<Run>(`${compare?'compare':'simulate'}?job_id=${id}`,cfg)
      if(compare)setComparison(data);else setRun(data)
      setHistory(prev=>[data,...prev.filter(r=>r.run_id!==data.run_id)].slice(0,12))
      let storageWarning = ''
      try {await saveRun(data);const all=await loadRuns();await Promise.all(all.slice(12).map(r=>deleteRun(r.run_id)))} catch {storageWarning = ' Browser storage unavailable—export JSON to keep this run.'}
      setToast(`${compare?'Comparison':'Simulation'} complete · ${number(data.results.reduce((a,r)=>a+r.trials_run,0))} trials in ${data.duration_seconds.toFixed(2)}s.${storageWarning}`)
      setHealth(true)
    } catch(e) {setError(e instanceof Error?e.message:'The simulation could not be completed. Please try again.')}
    finally {runLock.current=false;setBusy(false);setJobId(null)}
  }
  useEffect(()=>{
    if(started.current)return;started.current=true
    api<{status:string}>('health').then(()=>setHealth(true)).catch(()=>setHealth(false))
    api<{rates:Rate[]}>('failure-rates').then(d=>setRates(d.rates)).catch(e=>setError(String(e)))
    loadRuns().then(runs=>{setHistory(runs.slice(0,12));const s=runs.find(r=>r.kind==='simulation');const c=runs.find(r=>r.kind==='comparison');if(s){setRun(s);setConfig(normalizeConfig(s.config))}if(c)setComparison(c)}).catch(()=>setToast('Browser history is unavailable. You can still run experiments and export results.'))
  },[])
  useEffect(()=>{const cb=()=>setPage(getPage());window.addEventListener('hashchange',cb);return()=>window.removeEventListener('hashchange',cb)},[])
  useEffect(()=>{if(!busy)return;const t=setInterval(()=>setElapsed(n=>n+1),1000);return()=>clearInterval(t)},[busy])
  useEffect(()=>{
    if(!jobId)return
    let stopped=false
    let timer: ReturnType<typeof setTimeout>
    const controller=new AbortController()
    const poll=async()=>{
      try {
        const state=await api<Progress>(`progress/${jobId}`,undefined,controller.signal)
        if(!stopped){setProgress(state);setProgressConnected(true)}
      } catch {if(!stopped)setProgressConnected(false)}
      if(!stopped)timer=setTimeout(poll,500)
    }
    timer=setTimeout(poll,250)
    return()=>{stopped=true;clearTimeout(timer);controller.abort()}
  },[jobId])
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),5500);return()=>clearTimeout(t)},[toast])
  useEffect(()=>{
    const controller=new AbortController();configVersion.current+=1;setFailed([]);setLogs([]);setState(null);setTopologyError('');setTopologyBusy(true)
    const invalid=configError(config);if(invalid){setTopologyError(invalid);setTopologyBusy(false);return}
    const t=setTimeout(()=>{api<FacilityState>('topology',config,controller.signal).then(d=>{setState(d);setTopologyBusy(false)}).catch(e=>{if(e.name!=='AbortError'){setState(null);setTopologyError(e.message||'Topology unavailable. Please retry.');setTopologyBusy(false)}})},150)
    return()=>{clearTimeout(t);controller.abort()}
  },[config])
  useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setShowGuide(false);setShowReport(false);setShowExport(false);setMobileOpen(false)}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey)},[])
  useEffect(()=>{const t=setInterval(()=>{api<{status:string}>('health').then(()=>setHealth(true)).catch(()=>setHealth(false))},30000);return()=>clearInterval(t)},[])
  useEffect(()=>{
    if(!showGuide&&!showReport)return
    const previous=document.activeElement as HTMLElement|null
    const modal=document.querySelector<HTMLElement>('[role="dialog"]')
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab'||!modal)return;const items=Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,summary,[tabindex="0"]'));const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus()}
  },[showGuide,showReport])
  async function inject(ids: string[], label: string, hours=duration) {
    if(runLock.current||labLock.current||topologyBusy||!!configError(config))return
    labLock.current=true
    const version=configVersion.current
    setLabBusy(true);setError('')
    try {const s=await api<FacilityState>('inject-failure',{config,failed_components:ids,duration_hours:hours});if(version!==configVersion.current)return;setState(s);setDuration(hours);setFailed(ids);setLogs(l=>[{time:new Date().toLocaleTimeString('en-GB'),text:`${label} · ${number(s.surviving_capacity_kw)} kW available / ${number(config.it_load_kw)} kW required`,healthy:s.service_maintained},...l].slice(0,50))}
    catch(e){setError(e instanceof Error?e.message:'Injection failed')}finally{labLock.current=false;setLabBusy(false)}
  }
  function scenario(s: string) {
    const all=state?.groups.flatMap(g=>g.components)||[]
    const ups=all.filter(c=>c.kind==='UPS_MODULE')
    let ids:string[]=[]
    if(s==='single')ids=ups.slice(0,1).map(c=>c.id)
    if(s==='double')ids=ups.slice(0,2).map(c=>c.id)
    if(s==='cross')ids=[all.find(c=>c.id==='UPS-A01')?.id,all.find(c=>c.id==='PDU-B01')?.id].filter((id):id is string=>!!id)
    if(s==='path')ids=all.filter(c=>c.bank==='A'&&['UPS_MODULE','GENERATOR','PDU','ATS'].includes(c.kind)).map(c=>c.id)
    if(s==='cooling')ids=all.filter(c=>c.kind==='CRAC').map(c=>c.id)
    if(s==='server'||s==='os')ids=all.filter(c=>c.kind==='SERVER').slice(0,1).map(c=>c.id)
    if(s==='servers')ids=all.filter(c=>c.kind==='SERVER').slice(0,2).map(c=>c.id)
    if(s==='storage')ids=all.filter(c=>c.kind==='STORAGE').map(c=>c.id)
    if(s==='network')ids=all.filter(c=>c.kind==='NETWORK').map(c=>c.id)
    if(s==='application')ids=all.filter(c=>c.kind==='APPLICATION').map(c=>c.id)
    if(s==='surge')ids=all.filter(c=>['UPS_MODULE','GENERATOR'].includes(c.kind)).map(c=>c.id)
    if(['server','os','servers','storage','network','application','surge'].includes(s)){
      const kind: Record<string,string>={server:'SERVER',os:'OS',servers:'SERVER',storage:'STORAGE',network:'NETWORK',application:'APPLICATION'}
      const hours=rates.find(r=>r.component===kind[s])?.mttr_hours??duration
      void inject(ids,`Scenario: ${s==='os'?'OS/hypervisor crash on server node (same capacity impact)':s} · assumed recovery ${hours} h`,hours);return
    }
    void inject(ids,`Scenario: ${s==='cross'?'UPS A + PDU B outage':s==='path'?'power path A outage':s==='cooling'?'all cooling offline':`${s} UPS failure`}`)
  }
  async function removeHistory(id: string) {if(!confirm('Delete this saved run from this browser?'))return;try{await deleteRun(id);setHistory(h=>h.filter(r=>r.run_id!==id));setToast('Saved run deleted.')}catch{setError('Could not delete this saved run.')}}
  function openHistory(r: Run) {if(busy||labBusy){setToast('Wait for the current operation before restoring a run.');return}setConfig(normalizeConfig(structuredClone(r.config)));if(r.kind==='comparison')setComparison(r);else setRun(r);nav(r.kind==='comparison'?'comparison':'simulation');setToast('Saved experiment restored. Run again to reproduce it.')}
  const report = (r: Run) => {setReportRun(r);setShowReport(true);setShowExport(false)}
  const exportActive = (format:'json'|'csv'|'trials') => {if(activeRun){exportRun(activeRun,format);setShowExport(false);setToast('Download prepared.')}}
  const newExperiment=()=>{if(busy||labBusy)return;setConfig(structuredClone(DEFAULT_CONFIG));setRun(null);setComparison(null);setError('');nav('simulation');setToast('New experiment ready. Configure your facility, then run the simulation.')}

  return <div className="app-shell">
    {mobileOpen&&<div className="sidebar-backdrop" onClick={()=>setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen?'mobile-open':''}`}>
      <a className="brand" href="#simulation" onClick={()=>nav('simulation')}><span className="brand-mark"><Activity size={23} strokeWidth={2.5}/></span><div><strong>DC-Resilience<span className="brand-dot">.</span></strong><small>RELIABILITY, BY DESIGN</small></div></a>
      <div className="workspace-switch"><div className="workspace-avatar"><FlaskConical size={17}/></div><div><strong>Research workspace</strong><span>SRM IST · Academic project</span></div><span className="workspace-badge">01</span></div>
      <div className="nav-label">WORKSPACE</div><nav aria-label="Main navigation">{NAV.map(item=><button key={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>nav(item.id)}><item.icon size={18}/><span>{item.label}</span>{item.id==='lab'&&<i className="nav-live"/>}{item.id==='history'&&history.length>0&&<b>{history.length}</b>}</button>)}</nav>
      <div className="nav-label resources-label">RESOURCES</div><nav aria-label="Resources"><button className={`nav-item ${page==='references'?'active':''}`} onClick={()=>nav('references')}><Database size={18}/><span>Reference library</span></button><button className={`nav-item ${page==='methodology'?'active':''}`} onClick={()=>nav('methodology')}><BookOpen size={18}/><span>Methodology</span></button><a className="nav-item" href="/docs" target="_blank" rel="noreferrer"><Code2 size={18}/><span>API documentation</span><ArrowUpRight size={13}/></a></nav>
      <div className="sidebar-bottom"><div className="demo-card"><span className="demo-card-icon"><FlaskConical size={17}/></span><strong>Built to test the what-ifs.</strong><p>One failed component can change everything. Put your design to the test.</p><button onClick={()=>{nav('lab');setShowGuide(true)}}>Explore the live demo<ArrowRight size={14}/></button></div><div className="engine-status"><span><i className={health?'online':''}/>{health?'Simulation engine online':'Connecting to engine'}</span><span>v2.3</span></div><button className="user-profile" onClick={()=>nav('methodology')}><div className="avatar">RD</div><div><strong>Romit & Shourya</strong><span>SRM Research Team</span></div><ChevronRight size={15}/></button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobileOpen(true)}><Menu size={20}/></button><span>Workspace</span><ChevronRight size={13}/><strong>{TITLES[page][0]}</strong></div><div className="topbar-actions"><span className="research-badge"><span/>RESEARCH DEMO</span><div className="topbar-divider"/><button className="icon-button" aria-label="Open demo guide" title="Demo guide" onClick={()=>setShowGuide(true)}><CircleHelp size={18}/></button><button className="avatar small" title="About the research team" onClick={()=>nav('methodology')}>RD</button></div></header>
    <main className="main-content"><div className="page-heading"><div><div className="heading-eyebrow"><i/> RESILIENCE ENGINEERING PLATFORM</div><h1>{TITLES[page][0]}</h1><p>{TITLES[page][1]}</p></div><div className="heading-actions">{['simulation','comparison'].includes(page)&&<div className="export-container"><button className="button" disabled={!activeRun||busy} onClick={()=>setShowExport(!showExport)} aria-expanded={showExport}><Download size={15}/>Export report<ChevronDown size={13}/></button>{showExport&&<><div className="menu-catcher" onClick={()=>setShowExport(false)}/><div className="export-menu"><button onClick={()=>exportActive('json')}><FileJson size={16}/><div>Complete experiment<small>JSON · parameters, sources & all trials</small></div></button><button onClick={()=>exportActive('csv')}><FileSpreadsheet size={16}/><div>Results summary<small>CSV · comparison-ready results</small></div></button><button onClick={()=>exportActive('trials')}><Database size={16}/><div>Individual trial data<small>CSV · all simulated trials</small></div></button><button onClick={()=>activeRun&&report(activeRun)}><Printer size={16}/><div>Printable design report<small>Print or save as PDF</small></div></button></div></>}</div>}<button className="button dark" disabled={busy||labBusy} onClick={newExperiment}><Plus size={16}/>New experiment</button></div></div>
      <div className="context-bar"><div><span><FlaskConical size={14}/>Monte Carlo simulation</span><i/><span>{config.simulation.dependent_failures?`${config.simulation.common_cause_target==='application'?'Shared deployment':'Common-cause'} + independent model`:'Independent failure model'}</span><i/><button onClick={()=>nav('references')}>Mixed-source assumptions <ArrowUpRight size={12}/></button></div><span className="context-right"><ShieldCheck size={13}/>Open source. Reproducible.</span></div>
      {['simulation','comparison','lab'].includes(page)&&<div className="data-warning"><Info size={16}/><p><strong>Assumption-based research demo.</strong> PDU, cooling and IT rates are unverified; the generator source has conflicting values. INR costs are editable planning inputs—not quotes. No Tier certification claim.</p></div>}
      {error&&<div className="error-banner" role="alert"><Info size={18}/><div><strong>Something needs your attention</strong><p>{error}</p></div><button className="icon-button" onClick={()=>setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
      {['simulation','comparison','lab'].includes(page)&&<div className={`workspace-grid ${page==='lab'?'lab-grid':''}`}><ConfigPanel config={config} setConfig={setConfig} busy={busy||labBusy} compare={page==='comparison'} onRun={()=>void execute(page==='comparison')}/><div className="workspace-main">{topologyError&&<div className="error-banner" role="alert"><Info size={18}/><p>{topologyError}</p></div>}
        {page==='simulation'&&<><FacilityDiagram state={topologyBusy?null:state} config={config} failed={failed} unavailable={!!topologyError} compact/><button className="lab-link" onClick={()=>nav('lab')}><Zap size={14}/><span>What happens if a component fails?</span><strong>Open live failure lab<ArrowUpRight size={14}/></strong></button></>}
        {stale&&page!=='lab'&&!busy&&<div className="stale-banner"><Info size={15}/>Configuration changed. Results below belong to the previous experiment.<button onClick={()=>void execute(page==='comparison')}>Run updated design<ArrowRight size={13}/></button></div>}
        {busy&&page!=='lab'?<div className="running-panel panel" role="status" aria-live="polite"><div className="running-orbit"><FlaskConical size={31}/><i/><i/></div><span className="eyebrow">EXPERIMENT IN PROGRESS</span><h2>Putting your design to the test.</h2><p>Sampling hardware and software failures in bounded batches, integrating repairs and measuring service impact.</p>{progress?<div className="measured-progress"><div><strong>{progress.phase}</strong><span>{number(progress.completed_trials)} / {number(progress.total_trials)} trial evaluations</span></div><progress aria-label="Completed trial evaluations" max={progress.total_trials} value={progress.completed_trials}/><small>{progressConnected?'Measured at completed batches; diagnostics are included.':'Waiting for live counters; the request may still be running.'} Not a time-to-completion estimate.</small></div>:<div className="indeterminate-progress"><i/></div>}<div className="running-meta"><span><LoaderCircle size={13} className="spin"/>NumPy simulation engine</span><span>{elapsed}s elapsed</span></div><small>{config.simulation.diagnostics?'Includes all diagnostic reruns; their sample size is shown separately.':'Real calculations. No pre-computed reliability scores.'}</small></div>:null}
        {page==='simulation'&&!busy&&(run?<ResultsDashboard key={run.run_id} run={run} onCompare={()=>nav('comparison')}/>:<EmptyState icon={FlaskConical} title="Your next insight starts here." description="Configure a facility, choose your redundancy, and run thousands of independent failure trials." action="Run first simulation" onAction={()=>void execute()}/>)}
        {page==='comparison'&&!busy&&(comparison?<Comparison key={comparison.run_id} run={comparison}/>:<div className="comparison-empty"><div className="comparison-illustration"><span>N</span><span>N+1</span><span>2N</span><div className="comparison-baseline"/></div><span className="eyebrow">ONE EXPERIMENT. THREE ARCHITECTURES.</span><h2>Find your resilience sweet spot.</h2><p>Hold your facility load constant. Compare availability, downtime, SLA performance and infrastructure overhead across N, N+1 and 2N.</p><button className="button primary" onClick={()=>void execute(true)}><GitCompareArrows size={16}/>Run comparative study</button><div className="comparison-empty-notes"><span><CheckCircle2 size={14}/>Identical IT load</span><span><CheckCircle2 size={14}/>Shared random streams</span><span><CheckCircle2 size={14}/>Export-ready results</span></div></div>)}
        {page==='lab'&&<FailureLab config={config} state={topologyBusy?null:state} failed={failed} busy={busy||labBusy||topologyBusy||!!topologyError} duration={duration} onDuration={hours=>void inject(failed,`Scenario duration set to ${hours} hours`,hours)} unavailable={!!topologyError} onToggle={id=>void inject(failed.includes(id)?failed.filter(x=>x!==id):[...failed,id],`${failed.includes(id)?'Repaired':'Failed'} ${id}`)} onReset={()=>void inject([],'All components restored')} onScenario={scenario} logs={logs}/>}
      </div></div>}
      {page==='history'&&<HistoryView history={history} onOpen={openHistory} onDelete={removeHistory} onReport={report} onNew={newExperiment}/>}
      {page==='references'&&<References rates={rates}/>}
      {page==='methodology'&&<Methodology/>}
      <footer className="page-footer"><span>DC-Resilience <span> / </span> Quantifying the value of redundancy.</span><button onClick={()=>nav('methodology')}>An SRM IST research project<ArrowUpRight size={12}/></button></footer>
    </main></div>
    {toast&&<div className="toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span><button aria-label="Dismiss notification" onClick={()=>setToast('')}><X size={14}/></button></div>}
    {showGuide&&<div className="modal-backdrop" onClick={()=>setShowGuide(false)}><section role="dialog" aria-modal="true" aria-labelledby="guide-title" className="modal guide-modal" onClick={e=>e.stopPropagation()}><div className="modal-header"><span className="modal-icon"><Play size={22}/></span><button className="icon-button" aria-label="Close demo guide" autoFocus onClick={()=>setShowGuide(false)}><X size={20}/></button></div><span className="eyebrow">YOUR TWO-MINUTE DEMO</span><h2 id="guide-title">Make resilience visible.</h2><p>Take your audience from a design decision to a measurable outcome.</p><div className="guide-steps">{[['1','Start with N+1','The default 10 MW facility has one spare in each group. Run 10,000 trials and review its measured availability.'],['2','Break it, live','Open the failure lab. Fail one UPS: service is protected. Fail a second: capacity drops below the IT load. Restore all to recover.'],['3','Compare the alternatives','Run the comparative study to see N, N+1 and 2N side by side. Discuss both downtime and infrastructure overhead.'],['4','Show your working','Export the design report. Open Reference library to explain the cited data, illustrative assumptions and research limitations.']].map(([n,title,text])=><div key={n}><b>{n}</b><div><h3>{title}</h3><p>{text}</p></div></div>)}</div><details className="guide-controls"><summary>What does each control do?</summary><dl><dt>Presets / Reset / New experiment</dt><dd>Load sensible parameters; reset the form; or clear current results and start fresh. Saved history is kept.</dd><dt>Target tier</dt><dd>Changes the historical SLA benchmark, not the physical equipment. Tier III corresponds to 94.608 allowed downtime minutes/year.</dd><dt>IT load / power / cooling</dt><dd>Set demand and each subsystem’s redundancy. Required units are rounded up from load ÷ unit rating.</dd><dt>Trials / years / seed</dt><dd>Choose the number of independent experiments, duration of each, and a repeatable random stream. Same complete configuration and engine version reproduce results.</dd><dt>Failure mode / stress / operating scenario</dt><dd>Allow independent overlaps or suppress them for a controlled baseline. Stress multiplies hazards, not repair durations. Islanded mode requires generators continuously; utility mode assumes a perfect grid.</dd><dt>Run simulation / Compare architectures</dt><dd>Compute one configured design or N, N+1 and 2N with the same demand and assumptions. No result is a Tier certificate.</dd><dt>Overview / Distribution / Events / Trial replay</dt><dd>Inspect convergence, downtime frequencies, the first 60 failure samples, or every failure and repair in the highest-downtime trial. Replay’s Play advances event by event, not in real time.</dd><dt>Live lab / quick scenarios / Restore all</dt><dd>Click units to fail or repair them. Quick scenarios replace the current failures; they are not cumulative. Duration sets a hypothetical hold time, not an automatic repair countdown.</dd><dt>Exports / history / references / API</dt><dd>Download JSON, summary CSV, all trials CSV, or print PDF. History stores the last 12 runs on this browser. References show data provenance; API documentation lets you inspect endpoints.</dd></dl></details><button className="button primary" onClick={()=>{setShowGuide(false);nav('lab')}}>Let's test the design<ArrowRight size={16}/></button></section></div>}
    {showReport&&reportRun&&<div className="modal-backdrop report-backdrop" onClick={()=>setShowReport(false)}><section role="dialog" aria-modal="true" aria-labelledby="report-title" className="modal report-modal" onClick={e=>e.stopPropagation()}><div className="report-controls"><button className="button primary" onClick={()=>window.print()}><Printer size={15}/>Print / Save PDF</button><button className="icon-button" autoFocus aria-label="Close report" onClick={()=>setShowReport(false)}><X size={20}/></button></div><DesignReport run={reportRun}/></section></div>}
  </div>
}
function EmptyState({icon:Icon,title,description,action,onAction}:{icon:typeof FlaskConical;title:string;description:string;action:string;onAction:()=>void}) {return <div className="panel empty-state"><div><Icon size={32}/></div><h2>{title}</h2><p>{description}</p><button className="button primary" onClick={onAction}><Play size={14}/>{action}</button></div>}
function HistoryView({history,onOpen,onDelete,onReport,onNew}:{history:Run[];onOpen:(r:Run)=>void;onDelete:(id:string)=>void;onReport:(r:Run)=>void;onNew:()=>void}) {
  const [query,setQuery]=useState('');const [kind,setKind]=useState('all')
  const shown=history.filter(r=>(r.config.facility_name.toLowerCase().includes(query.toLowerCase())||r.run_id.includes(query))&&(kind==='all'||r.kind===kind))
  return <div className="history-page"><div className="history-summary"><div className="panel"><History size={20}/><div><strong>{history.length}</strong><span>Saved experiments</span></div></div><div className="panel"><BarChart3 size={20}/><div><strong>{number(history.reduce((a,r)=>a+r.results.reduce((b,s)=>b+s.trials_run,0),0))}</strong><span>Total simulated trials</span></div></div><div className="panel"><Database size={20}/><div><strong>On this device</strong><span>Last 12 runs · browser storage</span></div></div></div><section className="panel"><div className="reference-toolbar"><div className="search-input"><Search size={16}/><input aria-label="Search saved experiments" placeholder="Search experiments…" value={query} onChange={e=>setQuery(e.target.value)}/></div><select aria-label="Filter experiment type" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All experiments</option><option value="simulation">Simulations</option><option value="comparison">Comparisons</option></select></div>{shown.length?<div className="table-scroll"><table><thead><tr><th>Experiment</th><th>Architecture</th><th>IT load</th><th>Trials</th><th>Created</th><th>Actions</th></tr></thead><tbody>{shown.map(r=><tr key={r.run_id}><td><button className="history-name" onClick={()=>onOpen(r)}>{r.config.facility_name}<ArrowUpRight size={13}/></button><small className="table-sub mono">{r.run_id.slice(0,8)} · {r.kind}</small></td><td><span className="small-tag">{r.kind==='comparison'?'N / N+1 / 2N':r.results[0].redundancy}</span></td><td>{number(r.config.it_load_kw)} kW</td><td>{number(r.config.simulation.num_trials)}{r.kind==='comparison'?' × 3':''}</td><td>{new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}<small className="table-sub">{new Date(r.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</small></td><td><div className="table-actions"><button className="icon-button" title="Open experiment" aria-label={`Open ${r.run_id}`} onClick={()=>onOpen(r)}><FolderOpen size={16}/></button><button className="icon-button" title="Download full JSON" aria-label={`Download ${r.run_id}`} onClick={()=>exportRun(r,'json')}><Download size={16}/></button><button className="icon-button" title="Print report" aria-label={`Report ${r.run_id}`} onClick={()=>onReport(r)}><Printer size={16}/></button><button className="icon-button delete" title="Delete run" aria-label={`Delete ${r.run_id}`} onClick={()=>onDelete(r.run_id)}><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div>:<EmptyState icon={History} title={history.length?'No matching experiments.':'A clean slate for your research.'} description="Completed simulations and comparisons are saved here on this device. Download JSON for a permanent, portable record." action="New experiment" onAction={onNew}/>}</section><div className="inline-note"><Info size={15}/><span>Stored in IndexedDB on this browser only. Clearing site data removes saved runs. Export the complete JSON before your demonstration or research submission.</span></div></div>
}
function DesignReport({run}:{run:Run}) {
  return <article className="design-report"><span className="eyebrow">DC-RESILIENCE / REPRODUCIBLE EXPERIMENT</span><h1 id="report-title">{run.config.facility_name}</h1><div className="report-meta"><span>Run: {run.run_id}</span><span>{new Date(run.created_at).toLocaleString()}</span></div>
    <div className="data-warning"><Info size={17}/><p>Mixed-source demonstration. PDU, cooling and IT rates are assumptions; generator 0.58/year conflicts with 115/266. No field validation or Tier certification. Budget figures are editable assumptions, not quotes.</p></div>
    <h2>01 / Experiment configuration</h2><div className="report-config"><div>IT load<strong>{number(run.config.it_load_kw)} kW</strong></div><div>Trials / design<strong>{number(run.config.simulation.num_trials)}</strong></div><div>Horizon<strong>{run.config.simulation.simulated_years_per_trial} year(s)</strong></div><div>Seed<strong>{run.config.simulation.seed}</strong></div><div>Operating mode<strong>{run.config.simulation.operating_mode}</strong></div><div>Stress multiplier<strong>{run.config.simulation.stress_multiplier}×</strong></div><div>IT service model<strong>{run.config.it?.enabled?'Enabled':'Disabled / legacy'}</strong></div><div>Dataset<strong>{run.dataset_version}</strong></div></div>
    {run.input_fingerprint&&<p className="mono">Input fingerprint (SHA-256): {run.input_fingerprint}</p>}
    <p>Engine {run.engine_version} · {run.config.simulation.failure_mode} failures · {run.config.simulation.dependent_failures?`common-cause enabled (${run.config.simulation.common_cause_target??'power'})`:'independent baseline'}. {run.config.maintenance?.enabled?(run.config.maintenance.inject_failure?'Conditional maintenance + forced-fault stress test, not an annual forecast.':'One scheduled maintenance window per trial.'):'No scheduled maintenance.'}</p>
    <h2>02 / Results and uncertainty</h2><table><thead><tr><th>Design</th><th>Availability (95% interval)</th><th>Downtime / year</th><th>SLA breaches</th><th>Planning INR</th></tr></thead><tbody>{run.results.map(r=><tr key={r.redundancy}><td>{r.redundancy}</td><td>{availability(r.availability_percent)}%<br/>{r.availability_ci95.map(v=>v.toFixed(6)).join(' – ')}%<br/>{r.availability_ci_method}</td><td>{number(r.expected_annual_downtime_minutes,3)} min{r.annual_downtime_ci95&&<><br/>95% interval: {r.annual_downtime_ci95.map(v=>number(v,3)).join(" – ")} min</>}</td><td>{number(r.sla_breach_rate_percent,3)}%</td><td>{r.budget?inr(r.budget.total_inr):'Legacy count index '+number(r.infra_cost_index,2)}</td></tr>)}</tbody></table>
    {run.results.map(r=><p className="report-ci" key={r.redundancy}>{r.redundancy}: {r.outage_trials} outage trials; evidence: {r.evidence_status}. Trial-outage probability 95% interval {r.outage_probability_ci95.map(v=>number(v*100,4)).join(' – ')}%. Unserved energy {number(r.expected_unserved_energy_kwh_per_year,3)} kWh/year. {r.maintenance&&`Maintenance-only tolerance: ${r.maintenance.maintenance_only_maintained?'yes':'no'}; window outage trials ${r.maintenance.window_outage_trials}; mean window downtime ${r.maintenance.mean_window_downtime_minutes.toFixed(3)} min. Forced-fault trials: ${r.maintenance.forced_fault_applied_trials??"unrecorded"} applied; ${r.maintenance.forced_fault_skipped_trials??"unrecorded"} skipped (no peer).`}</p>)}
    {!!run.paired_comparisons?.length&&<><h2>03 / Paired architecture differences</h2>{run.paired_comparisons.map(p=><p key={p.baseline+p.alternative}>{p.baseline} → {p.alternative}: {number(p.downtime_reduction_minutes,3)} min/year saved; approx. 95% CI {p.ci95.map(v=>number(v,3)).join(' to ')}. {p.evidence_limited?'Sparse paired evidence.':''}</p>)}</>}
    {run.diagnostics&&<><h2>Diagnostic sensitivity · {run.diagnostics.trials} paired trials / rerun</h2><p>{run.diagnostics.basis}</p><table><thead><tr><th>Rate changed</th><th>−50% downtime delta [CI]</th><th>+50% downtime delta [CI]</th></tr></thead><tbody>{run.diagnostics.sensitivity.map(x=><tr key={x.kind}><td>{x.label}</td>{[x.low,x.high].map((d,i)=><td key={i}>{number(d.delta_minutes,3)} [{d.ci95.map(v=>number(v,3)).join(', ')}] {d.evidence_limited?'Sparse':''}</td>)}</tr>)}</tbody></table><p>Independent {number(run.diagnostics.baseline_downtime_minutes,3)} vs dependent {number(run.diagnostics.dependent_downtime_minutes,3)} min/year. Paired change CI {run.diagnostics.dependency_effect.ci95.map(v=>number(v,3)).join(' to ')}. {run.diagnostics.dependency_effect.evidence_limited?'Sparse evidence.':''}</p></>}
    <h2>04 / Sources and effective operating rates</h2><table><thead><tr><th>Type</th><th>Reference λ/year · MTTR</th><th>Provenance</th></tr></thead><tbody>{run.failure_rates.map(r=><tr key={r.component}><td>{r.component}</td><td>{r.failure_rate_per_year} · {r.mttr_hours} h</td><td>{r.status}: {r.source}<br/>{r.notes}<br/>{r.source_url}</td></tr>)}</tbody></table><p>Effective rate before global stress: {Object.entries(run.results[0].effective_rates??{}).map(([k,v])=>`${k}: ${v.toFixed(6)}`).join('; ')}.</p>
    <h2>05 / Methodology and limitations</h2><ul>{run.model_notes.map((note,i)=><li key={i}>{note}</li>)}</ul><h2>06 / Complete configuration</h2><pre className="report-json">{JSON.stringify(run.config,null,2)}</pre><footer>Romit Deokar · Shourya Saran / SRM IST · Export JSON for all trial records and diagnostics.</footer></article>
}
