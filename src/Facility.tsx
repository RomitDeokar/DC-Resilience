import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Bug, CheckCircle2, Download, Grid3X3, HardDrive, Info, Layers, LoaderCircle, Network, Plus, RotateCcw, Save, Server, ShieldCheck, ShieldOff, Trash2, Upload, Zap } from 'lucide-react'
import { api } from './api'
import { number, type Page } from './types'

/* ------------------------------------------------------------------ types */
export type DeviceKind = 'compute'|'storage'|'network'|'ups'|'blank'
export interface Device {id:string;name:string;kind:DeviceKind;u_position:number;height_u:number;power_kw:number;os:string;segment:string;patched:boolean}
export interface Rack {id:string;name:string;row:number;col:number;height_u:number;max_power_kw:number;feed:'A'|'B'|'AB';cooling_zone:string;devices:Device[]}
export interface Layout {name:string;rows:number;cols:number;racks:Rack[];failed_feeds:('A'|'B')[];failed_zones:string[];failed_racks:string[]}
export interface Service {id:string;name:string;tier:string;hosts:string[];min_replicas:number;depends_on:string[];stateful:boolean}
interface Threat {kind:string;origin_host:string;hops:number}
interface RackEval {id:string;name:string;row:number;col:number;feed:string;cooling_zone:string;load_kw:number;max_power_kw:number;utilization_percent:number;used_u:number;height_u:number;free_u:number;devices:number;online:boolean;status:string}
interface LayoutEval {racks:RackEval[];zones:{zone:string;racks:number;load_kw:number;online:boolean}[];total_load_kw:number;online_load_kw:number;lost_load_kw:number;installed_capacity_kw:number;rack_count:number;online_racks:number;device_count:number;average_density_kw:number;warnings:string[];note:string}
interface SoftwareEval {hosts:{id:string;name:string;kind:string;rack:string;segment:string;os:string;patched:boolean;online:boolean;reason:string|null}[];services:{id:string;name:string;tier:string;up:boolean;healthy_replicas:number;total_replicas:number;min_replicas:number;reason:string;degraded:boolean;depends_on:string[];stateful:boolean}[];threats:{kind:string;origin:string;infected:string[];trace:string[];description:string}[];infected_hosts:string[];services_up:number;services_total:number;applications_up:number;applications_total:number;estimated_recovery_hours:number;state:string;recommendations:string[];note:string}
interface Catalog {threats:{kind:string;recovery_hours:number;description:string}[];tiers:string[]}

const STORE='dc-resilience-facility-layout-v1'
const KIND_META:Record<DeviceKind,{label:string;icon:typeof Server;u:number;kw:number}>={compute:{label:'Compute',icon:Server,u:2,kw:.8},storage:{label:'Storage',icon:HardDrive,u:4,kw:1.2},network:{label:'Network',icon:Network,u:1,kw:.3},ups:{label:'Rack UPS',icon:Zap,u:2,kw:0},blank:{label:'Blank panel',icon:Layers,u:1,kw:0}}
const TIER_LABEL:Record<string,string>={hypervisor:'Hypervisor',operating_system:'Operating system',database:'Database',message_queue:'Message queue',application:'Application',load_balancer:'Load balancer',orchestration:'Orchestration',identity:'Identity',monitoring:'Monitoring',backup:'Backup'}
const err=(e:unknown)=>e instanceof Error?e.message:'The request could not be completed.'
const download=(value:unknown,name:string)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
const nextId=(prefix:string,taken:string[])=>{let n=1;while(taken.includes(`${prefix}${String(n).padStart(2,'0')}`))n++;return `${prefix}${String(n).padStart(2,'0')}`}

/* ------------------------------------------------------------- shared state */
export function useFacilityModel() {
  const [layout,setLayout]=useState<Layout|null>(null)
  const [services,setServices]=useState<Service[]>([])
  const [loadError,setLoadError]=useState('')
  useEffect(()=>{
    let stopped=false
    try{const saved=localStorage.getItem(STORE);if(saved){const d=JSON.parse(saved);if(d.layout&&Array.isArray(d.services)){setLayout(d.layout);setServices(d.services);return}}}catch{/* fall through to default */}
    api<{layout:Layout;services:Service[]}>('software/default').then(d=>{if(!stopped){setLayout(d.layout);setServices(d.services)}}).catch(e=>{if(!stopped)setLoadError(err(e))})
    return()=>{stopped=true}
  },[])
  useEffect(()=>{if(layout)try{localStorage.setItem(STORE,JSON.stringify({layout,services}))}catch{/* storage unavailable */}},[layout,services])
  const reset=async()=>{const d=await api<{layout:Layout;services:Service[]}>('software/default');setLayout(d.layout);setServices(d.services)}
  return {layout,setLayout,services,setServices,loadError,reset}
}

/* ------------------------------------------------------------ rack planner */
export function RackPlanner({model,navigate}:{model:ReturnType<typeof useFacilityModel>;navigate:(p:Page)=>void}) {
  const {layout,setLayout,services,setServices}=model
  const [evaluation,setEvaluation]=useState<LayoutEval|null>(null)
  const [error,setError]=useState('')
  const [selected,setSelected]=useState<string|null>(null)
  const [moving,setMoving]=useState<string|null>(null)
  const [busy,setBusy]=useState(false)
  const file=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    if(!layout)return
    const c=new AbortController();setBusy(true)
    const t=setTimeout(()=>{api<LayoutEval>('racks/evaluate',layout,c.signal).then(d=>{setEvaluation(d);setError('');setBusy(false)}).catch(e=>{if(e.name!=='AbortError'){setError(err(e));setBusy(false)}})},120)
    return()=>{clearTimeout(t);c.abort()}
  },[layout])
  if(!layout)return <div className="panel ops-loading"><LoaderCircle className="spin"/>{model.loadError||'Loading floor plan…'}</div>
  const update=(fn:(l:Layout)=>Layout)=>setLayout(l=>l?fn(structuredClone(l)):l)
  const rack=layout.racks.find(r=>r.id===selected)||null
  const evalById=new Map(evaluation?.racks.map(r=>[r.id,r])??[])
  const addRack=(row:number,col:number)=>update(l=>{const id=nextId('R',l.racks.map(r=>r.id));l.racks.push({id,name:`Rack ${id}`,row,col,height_u:42,max_power_kw:12,feed:'AB',cooling_zone:`Zone ${row+1}`,devices:[]});setSelected(id);return l})
  const cellClick=(row:number,col:number,existing?:Rack)=>{
    if(moving){if(!existing||existing.id===moving){update(l=>{const r=l.racks.find(x=>x.id===moving);if(r){r.row=row;r.col=col}return l})}setMoving(null);return}
    if(existing)setSelected(existing.id);else addRack(row,col)
  }
  const removeRack=(id:string)=>{if(!confirm(`Remove ${id} and every device inside it?`))return;const hostIds=new Set(layout.racks.find(r=>r.id===id)?.devices.map(d=>d.id));update(l=>({...l,racks:l.racks.filter(r=>r.id!==id),failed_racks:l.failed_racks.filter(x=>x!==id)}));setServices(s=>s.map(x=>({...x,hosts:x.hosts.filter(h=>!hostIds.has(h))})));setSelected(null)}
  const toggle=(key:'failed_feeds'|'failed_zones'|'failed_racks',value:string)=>update(l=>{const arr=l[key] as string[];const i=arr.indexOf(value);if(i>=0)arr.splice(i,1);else arr.push(value);return l})
  const importFile=async(f?:File)=>{if(!f)return;try{if(f.size>500000)throw new Error('Layout files must be smaller than 500 KB.');const d=JSON.parse(await f.text());const l:Layout=d.layout??d;await api('racks/evaluate',l);setLayout(l);if(Array.isArray(d.services))setServices(d.services);setSelected(null)}catch(e){setError(err(e))}finally{if(file.current)file.current.value=''}}
  return <div className="fac">
    <div className="fac-toolbar">
      <div className="fac-toolbar-left"><label>Data hall<input value={layout.name} maxLength={80} onChange={e=>update(l=>({...l,name:e.target.value}))}/></label><label>Rows<input type="number" min={1} max={40} value={layout.rows} onChange={e=>update(l=>({...l,rows:Math.max(1,Math.min(40,Number(e.target.value)||1))}))}/></label><label>Columns<input type="number" min={1} max={60} value={layout.cols} onChange={e=>update(l=>({...l,cols:Math.max(1,Math.min(60,Number(e.target.value)||1))}))}/></label></div>
      <div className="fac-toolbar-right"><button className="button" onClick={()=>file.current?.click()}><Upload size={14}/>Import</button><input ref={file} type="file" accept="application/json" hidden onChange={e=>void importFile(e.target.files?.[0])}/><button className="button" onClick={()=>download({layout,services},'dc-floor-plan.json')}><Download size={14}/>Export</button><button className="button" onClick={()=>{if(confirm('Replace the current floor plan with the reference layout?'))void model.reset().catch(e=>setError(err(e)))}}><RotateCcw size={14}/>Reference layout</button></div>
    </div>
    {error&&<div className="error-banner" role="alert"><Info size={17}/><p>{error}</p></div>}
    <div className="fac-kpis">
      <Stat label="Racks" value={`${evaluation?.online_racks??'—'} / ${evaluation?.rack_count??layout.racks.length}`} note="online / placed"/>
      <Stat label="Devices" value={String(evaluation?.device_count??'—')} note="servers, storage, network"/>
      <Stat label="IT load" value={number(evaluation?.total_load_kw??0,1)} unit="kW" note={`${number(evaluation?.installed_capacity_kw??0)} kW rack capacity`}/>
      <Stat label="Load lost" value={number(evaluation?.lost_load_kw??0,1)} unit="kW" note="from failed feeds, zones or racks" tone={evaluation?.lost_load_kw?'bad':'good'}/>
      <Stat label="Average density" value={number(evaluation?.average_density_kw??0,2)} unit="kW / rack" note="placed racks only"/>
    </div>
    <div className="fac-layout">
      <section className="fac-floor">
        <div className="fac-floor-head"><div><h3><Grid3X3 size={15}/>Floor plan</h3><p>Click an empty cell to add a rack. Select a rack to edit it, or move it to any free cell.</p></div><div className="fac-legend"><span><i className="normal"/>Normal</span><span><i className="hot"/>&gt; 85 %</span><span><i className="overloaded"/>Overloaded</span><span><i className="failed"/>Offline</span></div></div>
        {moving&&<div className="fac-moving"><Info size={14}/>Choose a destination cell for <strong>{moving}</strong>. <button onClick={()=>setMoving(null)}>Cancel</button></div>}
        <div className="fac-grid-scroll"><div className="fac-grid" style={{gridTemplateColumns:`34px repeat(${layout.cols},minmax(74px,1fr))`}}>
          <span/>{Array.from({length:layout.cols},(_,c)=><span key={c} className="fac-axis">{String.fromCharCode(65+c%26)}{c>=26?Math.floor(c/26):''}</span>)}
          {Array.from({length:layout.rows},(_,row)=><RowCells key={row} row={row} layout={layout} evalById={evalById} selected={selected} moving={moving} onClick={cellClick}/>)}
        </div></div>
        <div className="fac-hazards">
          <span>Facility faults</span>
          {(['A','B'] as const).map(f=><button key={f} className={layout.failed_feeds.includes(f)?'on':''} onClick={()=>toggle('failed_feeds',f)}><Zap size={12}/>Feed {f} {layout.failed_feeds.includes(f)?'down':'up'}</button>)}
          {evaluation?.zones.map(z=><button key={z.zone} className={!z.online?'on':''} onClick={()=>toggle('failed_zones',z.zone)}>{z.zone} cooling {z.online?'up':'down'} · {z.racks} racks</button>)}
          {(layout.failed_feeds.length>0||layout.failed_zones.length>0||layout.failed_racks.length>0)&&<button onClick={()=>update(l=>({...l,failed_feeds:[],failed_zones:[],failed_racks:[]}))}><RotateCcw size={12}/>Restore all</button>}
        </div>
        {!!evaluation?.warnings.length&&<div className="fac-warnings">{evaluation.warnings.map((w,i)=><div key={i}><AlertTriangle size={13}/>{w}</div>)}</div>}
      </section>
      <aside className="fac-side">
        {rack?<RackEditor rack={rack} evaluation={evalById.get(rack.id)} failed={layout.failed_racks.includes(rack.id)} services={services} onChange={next=>update(l=>{const i=l.racks.findIndex(r=>r.id===rack.id);l.racks[i]=next;return l})} onMove={()=>setMoving(rack.id)} onRemove={()=>removeRack(rack.id)} onToggleFail={()=>toggle('failed_racks',rack.id)} onClose={()=>setSelected(null)}/>
        :<div className="fac-empty"><Server size={26}/><h3>No rack selected</h3><p>Select a rack on the floor to view its elevation, edit devices, change its power feed or cooling zone, or take it offline.</p><p className="subtle">{busy?'Evaluating layout…':evaluation?.note}</p><button className="button" onClick={()=>navigate('software')}>Open software stack <ArrowLeft size={13} style={{transform:'rotate(180deg)'}}/></button></div>}
      </aside>
    </div>
  </div>
}

function RowCells({row,layout,evalById,selected,moving,onClick}:{row:number;layout:Layout;evalById:Map<string,RackEval>;selected:string|null;moving:string|null;onClick:(r:number,c:number,existing?:Rack)=>void}) {
  return <>
    <span className="fac-axis">{row+1}</span>
    {Array.from({length:layout.cols},(_,col)=>{
      const r=layout.racks.find(x=>x.row===row&&x.col===col)
      const ev=r?evalById.get(r.id):undefined
      if(!r)return <button key={col} className={`fac-cell empty ${moving?'target':''}`} aria-label={`Add rack at row ${row+1} column ${col+1}`} onClick={()=>onClick(row,col)}><Plus size={13}/></button>
      return <button key={col} className={`fac-cell rack ${ev?.status??'normal'} ${selected===r.id?'selected':''} ${moving===r.id?'moving':''}`} onClick={()=>onClick(row,col,r)} title={`${r.name} · ${ev?number(ev.load_kw,1):'—'} kW`}>
        <strong>{r.id}</strong><small>{ev?`${number(ev.load_kw,1)} kW`:'…'}</small>
        <i style={{width:`${Math.min(100,ev?.utilization_percent??0)}%`}}/>
        <em>{r.feed}{ev&&!ev.online?' · off':''}</em>
      </button>
    })}
  </>
}

function RackEditor({rack,evaluation,failed,services,onChange,onMove,onRemove,onToggleFail,onClose}:{rack:Rack;evaluation?:RackEval;failed:boolean;services:Service[];onChange:(r:Rack)=>void;onMove:()=>void;onRemove:()=>void;onToggleFail:()=>void;onClose:()=>void}) {
  const [device,setDevice]=useState<string|null>(null)
  const [addKind,setAddKind]=useState<DeviceKind>('compute')
  useEffect(()=>setDevice(null),[rack.id])
  const set=<K extends keyof Rack>(k:K,v:Rack[K])=>onChange({...rack,[k]:v})
  const slots=useMemo(()=>{const arr:(Device|null)[]=Array(rack.height_u).fill(null);for(const d of rack.devices)for(let u=d.u_position;u<d.u_position+d.height_u&&u<=rack.height_u;u++)arr[u-1]=d;return arr},[rack])
  const firstFree=(h:number)=>{for(let u=1;u+h-1<=rack.height_u;u++){let ok=true;for(let k=u;k<u+h;k++)if(slots[k-1]){ok=false;break}if(ok)return u}return null}
  const addDevice=()=>{const m=KIND_META[addKind];const u=firstFree(m.u);if(u===null)return alert('No contiguous free U-space for this device.');const id=nextId(`${rack.id}-${addKind.slice(0,3).toUpperCase()}`,rack.devices.map(d=>d.id));onChange({...rack,devices:[...rack.devices,{id,name:`${m.label} ${rack.devices.filter(d=>d.kind===addKind).length+1}`,kind:addKind,u_position:u,height_u:m.u,power_kw:m.kw,os:addKind==='network'?'Network OS':addKind==='compute'?'Linux':'—',segment:'prod',patched:true}]});setDevice(id)}
  const dev=rack.devices.find(d=>d.id===device)
  const updateDevice=(next:Device)=>onChange({...rack,devices:rack.devices.map(d=>d.id===next.id?next:d)})
  const hostedBy=(id:string)=>services.filter(s=>s.hosts.includes(id)).map(s=>s.name)
  return <div className="fac-editor">
    <div className="fac-editor-head"><div><span className={`ops-pill ${evaluation?.status==='failed'?'red':evaluation?.status==='normal'?'green':'amber'}`}>{evaluation?.status??'—'}</span><h3>{rack.name}</h3><p className="mono">{rack.id} · row {rack.row+1}, col {String.fromCharCode(65+rack.col%26)}</p></div><button className="icon-button" aria-label="Close rack" onClick={onClose}>×</button></div>
    <div className="fac-editor-stats"><span>Load<strong>{number(evaluation?.load_kw??0,2)} <small>/ {rack.max_power_kw} kW</small></strong></span><span>U-space<strong>{evaluation?.used_u??0} <small>/ {rack.height_u} U</small></strong></span><span>Devices<strong>{rack.devices.length}</strong></span></div>
    <div className="fac-form">
      <label>Name<input value={rack.name} maxLength={60} onChange={e=>set('name',e.target.value)}/></label>
      <label>Height (U)<input type="number" min={10} max={52} value={rack.height_u} onChange={e=>set('height_u',Math.max(10,Math.min(52,Number(e.target.value)||42)))}/></label>
      <label>Power limit (kW)<input type="number" min={1} max={100} step=".5" value={rack.max_power_kw} onChange={e=>set('max_power_kw',Math.max(1,Math.min(100,Number(e.target.value)||1)))}/></label>
      <label>Power feed<select value={rack.feed} onChange={e=>set('feed',e.target.value as Rack['feed'])}><option value="AB">A + B (dual)</option><option value="A">A only</option><option value="B">B only</option></select></label>
      <label>Cooling zone<input value={rack.cooling_zone} maxLength={24} onChange={e=>set('cooling_zone',e.target.value)}/></label>
    </div>
    <div className="fac-editor-actions"><button className="button" onClick={onMove}>Move rack</button><button className={`button ${failed?'':'danger'}`} onClick={onToggleFail}>{failed?'Restore rack':'Take rack offline'}</button><button className="button" onClick={onRemove}><Trash2 size={13}/>Remove</button></div>
    <div className="fac-elevation-head"><h4>Rack elevation</h4><div><select value={addKind} onChange={e=>setAddKind(e.target.value as DeviceKind)}>{(Object.keys(KIND_META) as DeviceKind[]).map(k=><option key={k} value={k}>{KIND_META[k].label} · {KIND_META[k].u}U</option>)}</select><button className="button primary" onClick={addDevice}><Plus size={13}/>Add</button></div></div>
    <div className="fac-elevation">{Array.from({length:rack.height_u},(_,i)=>rack.height_u-i).map(u=>{const d=slots[u-1];const top=d&&d.u_position+d.height_u-1===u;if(d&&!top)return null;const K=d?KIND_META[d.kind].icon:null;return <div key={u} className={`fac-u ${d?`dev ${d.kind} ${device===d.id?'selected':''} ${!d.patched?'unpatched':''}`:''}`} style={d?{gridRow:`span ${Math.min(d.height_u,u)}`}:undefined} onClick={()=>d&&setDevice(d.id)} role={d?'button':undefined} tabIndex={d?0:undefined} onKeyDown={e=>{if(d&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setDevice(d.id)}}}><span className="fac-u-num">{u}</span>{d&&K&&<><K size={12}/><span className="fac-u-name">{d.name}</span><span className="fac-u-meta">{d.height_u}U · {number(d.power_kw,2)} kW</span></>}</div>})}</div>
    {dev&&<div className="fac-device">
      <div className="fac-editor-head"><div><h4>{dev.name}</h4><p className="mono">{dev.id}</p></div><button className="button" onClick={()=>{onChange({...rack,devices:rack.devices.filter(d=>d.id!==dev.id)});setDevice(null)}}><Trash2 size={13}/>Remove</button></div>
      <div className="fac-form two">
        <label>Name<input value={dev.name} maxLength={60} onChange={e=>updateDevice({...dev,name:e.target.value})}/></label>
        <label>Type<select value={dev.kind} onChange={e=>updateDevice({...dev,kind:e.target.value as DeviceKind})}>{(Object.keys(KIND_META) as DeviceKind[]).map(k=><option key={k} value={k}>{KIND_META[k].label}</option>)}</select></label>
        <label>Position (U)<input type="number" min={1} max={rack.height_u} value={dev.u_position} onChange={e=>updateDevice({...dev,u_position:Math.max(1,Math.min(rack.height_u,Number(e.target.value)||1))})}/></label>
        <label>Height (U)<input type="number" min={1} max={20} value={dev.height_u} onChange={e=>updateDevice({...dev,height_u:Math.max(1,Math.min(20,Number(e.target.value)||1))})}/></label>
        <label>Power (kW)<input type="number" min={0} max={60} step=".05" value={dev.power_kw} onChange={e=>updateDevice({...dev,power_kw:Math.max(0,Math.min(60,Number(e.target.value)||0))})}/></label>
        <label>Operating system<input value={dev.os} maxLength={40} onChange={e=>updateDevice({...dev,os:e.target.value})}/></label>
        <label>Network segment<input value={dev.segment} maxLength={24} onChange={e=>updateDevice({...dev,segment:e.target.value})}/></label>
        <label className="fac-check"><input type="checkbox" checked={dev.patched} onChange={e=>updateDevice({...dev,patched:e.target.checked})}/>Patched / hardened</label>
      </div>
      {hostedBy(dev.id).length>0&&<p className="subtle">Hosts: {hostedBy(dev.id).join(', ')}</p>}
    </div>}
  </div>
}

/* ---------------------------------------------------------- software stack */
export function SoftwareStack({model,navigate}:{model:ReturnType<typeof useFacilityModel>;navigate:(p:Page)=>void}) {
  const {layout,services,setServices}=model
  const [catalog,setCatalog]=useState<Catalog|null>(null)
  const [threats,setThreats]=useState<Threat[]>([])
  const [failedHosts,setFailedHosts]=useState<string[]>([])
  const [controls,setControls]=useState({segmentation:true,backups_available:true,endpoint_protection:false})
  const [result,setResult]=useState<SoftwareEval|null>(null)
  const [error,setError]=useState('')
  const [selected,setSelected]=useState<string|null>(null)
  const [draftThreat,setDraftThreat]=useState<Threat>({kind:'virus',origin_host:'',hops:2})
  const hosts=useMemo(()=>layout?layout.racks.flatMap(r=>r.devices.filter(d=>['compute','storage','network'].includes(d.kind)).map(d=>({...d,rack:r.id}))):[],[layout])
  useEffect(()=>{api<Catalog>('software/catalog').then(setCatalog).catch(e=>setError(err(e)))},[])
  useEffect(()=>{if(!draftThreat.origin_host&&hosts[0])setDraftThreat(t=>({...t,origin_host:hosts[0].id}))},[hosts,draftThreat.origin_host])
  useEffect(()=>{
    if(!layout)return
    const c=new AbortController()
    const t=setTimeout(()=>{api<SoftwareEval>('software/evaluate',{layout,services,threats,failed_hosts:failedHosts,...controls},c.signal).then(d=>{setResult(d);setError('')}).catch(e=>{if(e.name!=='AbortError')setError(err(e))})},120)
    return()=>{clearTimeout(t);c.abort()}
  },[layout,services,threats,failedHosts,controls])
  if(!layout)return <div className="panel ops-loading"><LoaderCircle className="spin"/>{model.loadError||'Loading software model…'}</div>
  const svc=services.find(s=>s.id===selected)
  const svcEval=result?.services.find(s=>s.id===selected)
  const updateService=(next:Service)=>setServices(s=>s.map(x=>x.id===next.id?next:x))
  const addService=()=>{const id=nextId('svc',services.map(s=>s.id));setServices(s=>[...s,{id,name:'New service',tier:'application',hosts:[],min_replicas:1,depends_on:[],stateful:false}]);setSelected(id)}
  const removeService=(id:string)=>{if(!confirm('Remove this service? Dependencies pointing at it will be cleared.'))return;setServices(s=>s.filter(x=>x.id!==id).map(x=>({...x,depends_on:x.depends_on.filter(d=>d!==id)})));setSelected(null)}
  const tiers=catalog?.tiers??Object.keys(TIER_LABEL)
  const byTier=tiers.map(t=>({tier:t,items:(result?.services??[]).filter(s=>s.tier===t)})).filter(g=>g.items.length)
  const infected=new Set(result?.infected_hosts??[])
  return <div className="fac">
    <div className="fac-kpis">
      <Stat label="Stack state" value={result?.state??'—'} note={`${result?.services_up??0} / ${result?.services_total??services.length} services up`} tone={result?.state==='NORMAL'?'good':result?.state==='CRITICAL'?'bad':'warn'}/>
      <Stat label="Applications" value={`${result?.applications_up??0} / ${result?.applications_total??0}`} note="customer-facing services online"/>
      <Stat label="Compromised hosts" value={String(result?.infected_hosts.length??0)} note={`${hosts.length} hosts in the floor plan`} tone={result?.infected_hosts.length?'bad':'good'}/>
      <Stat label="Recovery estimate" value={number(result?.estimated_recovery_hours??0)} unit="h" note="planning assumption, longest active threat"/>
      <Stat label="Unpatched hosts" value={String(hosts.filter(h=>!h.patched).length)} note="edit in the rack planner" tone={hosts.some(h=>!h.patched)?'warn':'good'}/>
    </div>
    {error&&<div className="error-banner" role="alert"><Info size={17}/><p>{error}</p></div>}
    <div className="fac-layout software">
      <section className="fac-floor">
        <div className="fac-floor-head"><div><h3><Layers size={15}/>Service dependency stack</h3><p>Services resolve bottom-up: a service is online when enough replicas are healthy and every dependency is up.</p></div><button className="button primary" onClick={addService}><Plus size={13}/>Add service</button></div>
        <div className="fac-stack">{byTier.map(g=><div className="fac-tier" key={g.tier}><span>{TIER_LABEL[g.tier]??g.tier}</span><div>{g.items.map(s=><button key={s.id} className={`fac-service ${s.up?s.degraded?'degraded':'up':'down'} ${selected===s.id?'selected':''}`} onClick={()=>setSelected(s.id)}><strong>{s.name}</strong><small>{s.healthy_replicas}/{s.total_replicas} replicas · min {s.min_replicas}</small><em>{s.reason}</em></button>)}</div></div>)}{!byTier.length&&<div className="fac-empty small"><p>No services defined. Add one and assign hosts from the rack planner.</p></div>}</div>
        <div className="fac-floor-head" style={{marginTop:22}}><div><h3><Server size={15}/>Host status</h3><p>Click a host to fail or repair its hardware. Compromised hosts come from the active threats below.</p></div></div>
        <div className="fac-hosts">{hosts.map(h=>{const st=result?.hosts.find(x=>x.id===h.id);const K=KIND_META[h.kind].icon;return <button key={h.id} className={`fac-host ${st&&!st.online?infected.has(h.id)?'infected':'down':''} ${!h.patched?'unpatched':''}`} title={`${h.name} · ${h.rack} · ${h.segment}${st?.reason?` · ${st.reason}`:''}`} onClick={()=>setFailedHosts(f=>f.includes(h.id)?f.filter(x=>x!==h.id):[...f,h.id])}><K size={11}/><span>{h.id.replace(/^R\d+-\d+-/,'')}</span><small>{h.rack} · {h.segment}</small></button>})}</div>
      </section>
      <aside className="fac-side">
        <div className="fac-editor">
          <div className="fac-editor-head"><div><h3><Bug size={15}/>Threat injection</h3><p>Deterministic propagation across the hosts you placed.</p></div></div>
          <div className="fac-form">
            <label>Threat<select value={draftThreat.kind} onChange={e=>setDraftThreat({...draftThreat,kind:e.target.value})}>{(catalog?.threats??[]).map(t=><option key={t.kind} value={t.kind}>{t.kind.replace('_',' ')} · {t.recovery_hours} h recovery</option>)}</select></label>
            <label>Origin host<select value={draftThreat.origin_host} onChange={e=>setDraftThreat({...draftThreat,origin_host:e.target.value})}>{hosts.map(h=><option key={h.id} value={h.id}>{h.id} · {h.segment}{h.patched?'':' · unpatched'}</option>)}</select></label>
            <label>Propagation hops<input type="number" min={0} max={20} value={draftThreat.hops} onChange={e=>setDraftThreat({...draftThreat,hops:Math.max(0,Math.min(20,Number(e.target.value)||0))})}/></label>
          </div>
          <p className="subtle">{catalog?.threats.find(t=>t.kind===draftThreat.kind)?.description}</p>
          <div className="fac-editor-actions"><button className="button danger" disabled={!draftThreat.origin_host||threats.length>=10} onClick={()=>setThreats(t=>[...t,draftThreat])}><Bug size={13}/>Release threat</button><button className="button" disabled={!threats.length&&!failedHosts.length} onClick={()=>{setThreats([]);setFailedHosts([])}}><RotateCcw size={13}/>Clean up</button></div>
          {threats.length>0&&<div className="fac-threats">{threats.map((t,i)=><div key={i}><span className="ops-pill red">{t.kind.replace('_',' ')}</span><span className="mono">{t.origin_host}</span><span>{t.hops} hops</span><button className="icon-button" aria-label="Remove threat" onClick={()=>setThreats(x=>x.filter((_,j)=>j!==i))}>×</button></div>)}</div>}
          <h4>Security controls</h4>
          <div className="fac-controls">
            <label className="fac-check"><input type="checkbox" checked={controls.segmentation} onChange={e=>setControls({...controls,segmentation:e.target.checked})}/><ShieldCheck size={13}/>Network segmentation enforced</label>
            <label className="fac-check"><input type="checkbox" checked={controls.endpoint_protection} onChange={e=>setControls({...controls,endpoint_protection:e.target.checked})}/><ShieldCheck size={13}/>Endpoint protection (blocks virus spread)</label>
            <label className="fac-check"><input type="checkbox" checked={controls.backups_available} onChange={e=>setControls({...controls,backups_available:e.target.checked})}/><Save size={13}/>Offline backups available</label>
          </div>
        </div>
        {svc&&<div className="fac-editor">
          <div className="fac-editor-head"><div><span className={`ops-pill ${svcEval?.up?svcEval.degraded?'amber':'green':'red'}`}>{svcEval?svcEval.up?svcEval.degraded?'degraded':'online':'down':'—'}</span><h3>{svc.name}</h3><p className="mono">{svc.id} · {svcEval?.reason}</p></div><button className="icon-button" aria-label="Close service" onClick={()=>setSelected(null)}>×</button></div>
          <div className="fac-form two">
            <label>Name<input value={svc.name} maxLength={60} onChange={e=>updateService({...svc,name:e.target.value})}/></label>
            <label>Layer<select value={svc.tier} onChange={e=>updateService({...svc,tier:e.target.value})}>{tiers.map(t=><option key={t} value={t}>{TIER_LABEL[t]??t}</option>)}</select></label>
            <label>Minimum replicas<input type="number" min={1} max={200} value={svc.min_replicas} onChange={e=>updateService({...svc,min_replicas:Math.max(1,Math.min(200,Number(e.target.value)||1))})}/></label>
            <label className="fac-check"><input type="checkbox" checked={svc.stateful} onChange={e=>updateService({...svc,stateful:e.target.checked})}/>Stateful (holds data)</label>
          </div>
          <h4>Depends on</h4>
          <div className="fac-chips">{services.filter(s=>s.id!==svc.id).map(s=><button key={s.id} className={svc.depends_on.includes(s.id)?'on':''} onClick={()=>updateService({...svc,depends_on:svc.depends_on.includes(s.id)?svc.depends_on.filter(d=>d!==s.id):[...svc.depends_on,s.id]})}>{s.name}</button>)}</div>
          <h4>Replica hosts <small>{svc.hosts.length} assigned</small></h4>
          <div className="fac-chips hosts">{hosts.map(h=><button key={h.id} className={svc.hosts.includes(h.id)?'on':''} title={`${h.name} · ${h.rack}`} onClick={()=>updateService({...svc,hosts:svc.hosts.includes(h.id)?svc.hosts.filter(x=>x!==h.id):[...svc.hosts,h.id]})}>{h.id}</button>)}</div>
          <div className="fac-editor-actions"><button className="button" onClick={()=>removeService(svc.id)}><Trash2 size={13}/>Remove service</button></div>
        </div>}
        {result&&result.threats.length>0&&<div className="fac-editor"><h4>Propagation trace</h4>{result.threats.map((t,i)=><div key={i} className="fac-trace"><strong>{t.kind.replace('_',' ')} from {t.origin}</strong><p>{t.description}</p><ol>{t.trace.map((line,j)=><li key={j}>{line}</li>)}</ol></div>)}</div>}
        {result&&result.recommendations.length>0&&<div className="fac-editor"><h4><ShieldOff size={14}/>Findings</h4><ul className="fac-findings">{result.recommendations.map((r,i)=><li key={i}><AlertTriangle size={12}/>{r}</li>)}</ul></div>}
        {result&&!result.recommendations.length&&<div className="fac-editor fac-ok"><CheckCircle2 size={16}/>No structural findings. Try releasing a worm without segmentation, or fail a whole rack in the <button className="text-button" onClick={()=>navigate('racks')}>rack planner</button>.</div>}
      </aside>
    </div>
    <div className="ops-footnote"><Info size={16}/><p>{result?.note??'Deterministic dependency and propagation model.'} Hosts and their patch status are edited in the rack planner.</p></div>
  </div>
}

function Stat({label,value,unit,note,tone}:{label:string;value:string;unit?:string;note:string;tone?:'good'|'bad'|'warn'}) {
  return <div className={`fac-stat ${tone??''}`}><span>{label}</span><strong>{value}{unit&&<small> {unit}</small>}</strong><p>{note}</p></div>
}
