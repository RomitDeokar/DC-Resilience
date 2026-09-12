import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { csvCell } from '../src/exports'
import { DEFAULT_CONFIG, configError, workEstimate } from '../src/types'

// Start the built FastAPI app first; override for another test deployment.
const url = process.env.DC_TEST_URL || 'http://127.0.0.1:8000'
test.setTimeout(120000)
test.use({ viewport: { width: 1440, height: 1000 } })

test('CSV cells neutralize formulas and preserve signed numeric deltas', () => {
  expect(csvCell(' =HYPERLINK("bad")')).toBe('"\' =HYPERLINK(""bad"")"')
  expect(csvCell('\t=1+1')).toBe('"\'\t=1+1"')
  expect(csvCell(-12.5)).toBe('"-12.5"')
  expect(csvCell('normal, text')).toBe('"normal, text"')
})

test('client and API agree on the compute budget', async ({request}) => {
  for (const nodes of [1, 12, 30]) {
    const c=structuredClone(DEFAULT_CONFIG)
    c.it.server_nodes_required=nodes
    const response=await request.post(`${url}/api/preflight`,{data:c})
    expect(response.ok()).toBeTruthy()
    const estimate=await response.json()
    expect(estimate.unit_trials).toBe(workEstimate(c).unitTrials)
    expect(estimate.max_trials).toBe(workEstimate(c).maxTrials)
    expect(configError(c)).toBe('')
  }
})

test('comparison exports JSON, both CSVs and a printable PDF; history restores', async ({page}, info) => {
  const errors: string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(url)
  await page.locator('#preset').selectOption('quick')
  await page.getByRole('button',{name:'Architecture comparison',exact:true}).click()
  const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/compare')
  await page.getByRole('button',{name:'Compare architectures',exact:true}).click()
  const response=await responsePromise
  expect(response.ok()).toBeTruthy()
  const run=await response.json()
  expect(run.results.map((r: {redundancy:string})=>r.redundancy)).toEqual(['N','N+1','2N'])
  expect(run.results.every((r: {trials_run:number})=>r.trials_run===1000)).toBeTruthy()
  await expect(page.getByText('Experiment complete',{exact:true})).toBeVisible()
  for (const [label,name] of [['Complete experiment','comparison.json'],['Results summary','summary.csv'],['Individual trial data','trials.csv']]) {
    await page.getByRole('button',{name:'Export report',exact:true}).click()
    const downloaded=page.waitForEvent('download')
    await page.getByRole('button',{name:new RegExp(label)}).click()
    const file=await downloaded
    await file.saveAs(info.outputPath(name))
    const content=await readFile(info.outputPath(name),'utf8')
    if(name.endsWith('.json')) expect(JSON.parse(content).run_id).toBe(run.run_id)
    else {
      expect(content).toContain('engine_version')
      expect(content).toContain(run.run_id)
      expect(content).toContain(run.input_fingerprint)
      expect(content.split('\r\n')).toHaveLength(name==='trials.csv'?3001:4)
    }
  }
  await page.getByRole('button',{name:'Export report',exact:true}).click()
  await page.getByRole('button',{name:/Printable design report/}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.design-report')).toContainText(run.run_id)
  await page.evaluate(()=>{window.print=()=>{document.documentElement.dataset.printCalled='yes'}})
  await page.getByRole('button',{name:'Print / Save PDF',exact:true}).click()
  await expect(page.locator('html')).toHaveAttribute('data-print-called','yes')
  await page.emulateMedia({media:'print'})
  await expect(page.locator('.sidebar')).toBeHidden()
  const pdf=await page.pdf({path:info.outputPath('comparison.pdf'),format:'A4',printBackground:true})
  expect(pdf.subarray(0,4).toString()).toBe('%PDF')
  expect(pdf.length).toBeGreaterThan(10000)
  await page.emulateMedia({media:'screen'})
  await page.getByRole('button',{name:'Close report',exact:true}).click()
  await page.reload()
  await expect(page.getByText('Experiment complete',{exact:true})).toBeVisible()
  expect(errors).toEqual([])
})

test('oversized jobs are blocked before submission and busy responses recover', async ({page}) => {
  await page.goto(url)
  await page.locator('#trials').selectOption('20000')
  await page.locator('#years').selectOption('5')
  await page.getByRole('button',{name:'Advanced settings',exact:true}).click()
  await page.locator('#stress').selectOption('20')
  await expect(page.getByRole('button',{name:'Run simulation',exact:true})).toBeDisabled()
  await expect(page.locator('.validation-message')).toContainText('45M')
  await page.getByRole('button',{name:'Reduce to a safe trial count',exact:true}).click()
  await expect(page.getByRole('button',{name:'Run simulation',exact:true})).toBeEnabled()
  await page.locator('#preset').selectOption('quick')
  await page.route('**/api/simulate?*',r=>r.fulfill({status:429,contentType:'application/json',headers:{'Retry-After':'5'},body:JSON.stringify({detail:'Two simulation jobs are already running. Retry after one finishes.'})}))
  await page.getByRole('button',{name:'Run simulation',exact:true}).click()
  await expect(page.locator('.error-banner')).toContainText('Two simulation jobs')
  await expect(page.getByRole('button',{name:'Run simulation',exact:true})).toBeEnabled()
})

test('server and OS lab scenarios, dependency and maintenance diagnostics render', async ({page}) => {
  const errors: string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(url)
  await page.getByRole('button',{name:'Live failure lab',exact:true}).click()
  const impact=page.locator('.lab-metrics .panel').last()
  for(const [scenario,expected] of [['Server hardware','Protected'],['OS / hypervisor crash','Protected'],['Two server nodes','Interrupted'],['All application replicas','Interrupted']]) {
    await page.getByRole('button',{name:scenario,exact:true}).click()
    await expect(impact.locator('strong')).toHaveText(expected)
  }
  await page.getByRole('button',{name:'Restore all',exact:true}).click()
  await expect(impact.locator('strong')).toHaveText('Protected')
  await page.getByRole('button',{name:'Simulation workspace',exact:true}).click()
  for(const preset of ['dependent','software','maintenance-only','maintenance','diagnostics']) {
    await page.locator('#preset').selectOption(preset)
    // Test the real 1,000-trial demo presets, including diagnostics.
    const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/simulate')
    await page.getByRole('button',{name:'Run simulation',exact:true}).click()
    const response=await responsePromise
    expect(response.ok()).toBeTruthy()
    await expect(page.getByRole('heading',{name:'Simulation results',exact:true})).toBeVisible()
    if(preset==='dependent') await expect(page.getByText(/distinct surge incidents/)).toBeVisible()
    if(preset==='software') await expect(page.getByText(/distinct deployment incidents/)).toBeVisible()
    if(preset==='maintenance-only') await expect(page.getByText(/natural failures may overlap/)).toBeVisible()
    if(preset==='maintenance') await expect(page.getByText(/Forced companion fault applied in/)).toBeVisible()
    if(preset==='diagnostics') await expect(page.getByRole('heading',{name:'Sensitivity / tornado chart',exact:true})).toBeVisible()
  }
  await page.getByRole('tab',{name:'Trial replay',exact:true}).click()
  await expect(page.getByRole('button',{name:'Next replay event',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Next replay event',exact:true}).click()
  await expect(page.locator('.replay-event')).toContainText('cause started')
  expect(errors).toEqual([])
})


test('completed-trial counters show real diagnostic work and clean up after completion', async ({page}) => {
  await page.goto(url)
  await page.locator('#preset').selectOption('diagnostics')
  const counter=page.waitForResponse(r=>new URL(r.url()).pathname.startsWith('/api/progress/')&&r.status()===200)
  await page.getByRole('button',{name:'Run simulation',exact:true}).click()
  const state=await (await counter).json()
  expect(state.total_trials).toBe(24000)
  expect(state.completed_trials).toBeGreaterThan(0)
  expect(state.completed_trials).toBeLessThanOrEqual(state.total_trials)
  await expect(page.getByRole('progressbar',{name:'Completed trial evaluations'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'Simulation results',exact:true})).toBeVisible()
  await expect(page.getByRole('progressbar',{name:'Completed trial evaluations'})).toHaveCount(0)
})

test('application diagnostics with disabled IT are blocked on client and server', async ({request}) => {
  const c=structuredClone(DEFAULT_CONFIG)
  c.it.enabled=false
  c.simulation.common_cause_target='application'
  c.simulation.diagnostics=true
  expect(configError(c)).toContain('IT service model')
  expect((await request.post(`${url}/api/preflight`,{data:c})).status()).toBe(422)
})
