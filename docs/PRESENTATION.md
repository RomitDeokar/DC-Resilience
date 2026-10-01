# DC-Resilience — Presentation & Viva Pack

**One line:** a reproducible Monte Carlo workbench that quantifies what data-centre
redundancy architectures (N, N+1, 2N) actually buy you — with auditable inputs,
confidence intervals, and a full provenance trail.

Authors: Romit Deokar (RA2411003010615), Shourya Saran (RA2411003010628)
Course: 21CSE745P — Foundations of Data Centre Infrastructure and Management
Repo: `github.com/RomitDeokar/DC-Resilience` · Engine v2.3.0 · MIT licensed

---

## 1. The problem we are addressing

- N, N+1 and 2N are usually chosen by **rule of thumb** or by equating a design with a
  **Tier label**. Neither tells you the *expected downtime* a design will produce.
- The quantity that matters — annual downtime — is driven by **overlapping failures**:
  a second failure arriving while the first is still being repaired.
- Hand-waving this is easy ("N+1 is safe"); computing it honestly is hard, because it needs
  **event scheduling, exact interval integration, and statistics over rare events**.
- Published component failure data is **mixed quality and internally inconsistent**.
  A credible tool must expose that, not paper over it.

**Our question:** holding load, ratings, horizon and seed constant, how much downtime do
N, N+1 and 2N produce — and how confident can we be in the difference?

---

## 2. What the system is

Two halves, deliberately separated:

| Layer | What it is | Role in the project |
|---|---|---|
| **Reliability research core** | Continuous-time renewal Monte Carlo engine (NumPy) + FastAPI | **The contribution.** Produces the paper's numbers. |
| **Facility operations modules** | Deterministic planning/design surfaces (rack planner, software threats, N−1 sweep, DCIM telemetry) | Supporting context; clearly labelled, *not* the paper's scope. |

Stack: Python 3.12 / FastAPI / NumPy / SciPy · React 19 / TypeScript / Vite / Recharts / React Flow ·
IndexedDB for local run history · WebSocket for synthetic telemetry · no paid APIs.

```
Browser ──HTTP──▶ FastAPI (backend/app.py)
   │                 ├─ /api/simulate, /api/compare  → engine.py (Monte Carlo)
   │                 ├─ /api/topology, /api/inject-failure → models.py (capacity/trains)
   │                 ├─ /api/software/*, /api/racks/*     → facility.py (design surfaces)
   │                 └─ /api/operations/*                 → operations.py (planning/DCIM)
   └──IndexedDB: last 12 runs, exportable JSON/CSV + printable report
```

---

## 3. The method (this is the part to defend)

1. **Continuous-time renewal sampling.** Each unit's time-to-failure is
   `TTF ~ Exp(scale = 8760 / λ_year)`; repair is a constant equal to the recorded MTTR;
   next failure is sampled from the end of the repair. Per-cause streams (hardware,
   OS/hypervisor) share a server id but never mask each other.
2. **Exact integration of overlapping outages.** All failure/repair events are sorted
   chronologically and the outage intervals are integrated exactly — **overlapping downtime
   is never double-counted**. A repair at the same instant as a failure is ordered correctly.
3. **Train-based capacity, not pooled capacity.** Usable power is the *maximum over complete
   trains* (`max_b min_k bank_k(b)`), and 2N requires two complete paths. A UPS failure in
   path A plus a PDU failure in path B interrupts service even when pooled capacity would
   look sufficient. Capacity NEVER flows across disconnected paths.
4. **Paired random streams.** N, N+1 and 2N are run on **shared component/unit/batch streams**,
   so the comparison is paired (lower variance, honest intervals).
5. **Conservative statistics.** Availability uses a normal mean interval; with **zero observed
   outages** it reports a conservative bound derived from exact trial-outage risk instead of a
   misleading `[100%, 100%]`. Outage and SLA-breach probabilities use exact
   **Clopper–Pearson** intervals. Sparse evidence is flagged, never painted green.
6. **Work budgeting & reproducibility.** A preflight caps weighted unit-trials (45 M) and
   exposes max safe trials; two concurrent CPU jobs, a third gets HTTP 429. A SHA-256 input
   fingerprint ties every result to its exact configuration, engine version and dataset version.

**Equations shown in-app (Methodology):** `TTF ~ Exp(8760/λ_year)`;
`A = 100·(1 − downtime/horizon)`; `D = (1 − A/100)·525,600`; single-component check `D ≈ λ_year·MTTR`.

---

## 4. Headline result — reproduced independently

Infrastructure-only configuration (IT service model disabled), the paper's three seeds
(42, 2026, 745), 10,000 trials per architecture (30,000 per architecture pooled):

| Architecture | Reproduced downtime (min/yr) | 95% CI | Paper | Independent analytic cross-check |
|---|---:|---|---:|---:|
| **N** | **1,889.29** | 1,870.68 – 1,907.90 | 1,889.29 | 1,899 (inside CI) |
| **N+1** | **5.21** | 4.38 – 6.04 | 5.21 | 4.57 (inside CI) |
| **2N** | **5.78** | 4.93 – 6.62 | 5.78 | 6.24 (inside CI) |

**Why this matters:** an *independent* stationary/renewal analytic calculation lands inside
our simulated confidence intervals for all three architectures. The simulator is not
self-consistent fiction — an external method agrees within uncertainty.

**The counter-intuitive finding worth presenting:** in this model **2N is not better than N+1**
(5.78 vs 5.21 min/yr). N+1's single spare already absorbs the dominant single-unit loss;
2N only adds protection against a *complete train* loss, which contributes little on top.
Meanwhile **N is catastrophic** (~1,889 min/yr ≈ 31.5 h/yr) because any one UPS failure is a
full outage. That is the "value of redundancy" story: the big win is N→N+1; 2N buys a
different, smaller risk and costs roughly double.

---

## 5. Feature catalogue (everything we can show)

### Research core (the contribution)
- **Simulation workspace** — configure facility load, per-unit ratings, redundancy, IT model,
  horizon, seed, stress multiplier, failure mode, operating mode (islanded/utility).
- **Architecture comparison** — N/N+1/2N on shared streams; architecture cards, availability
  and downtime charts, full results table, paired-difference table with CIs.
- **Live failure lab** — deterministic fault injection on the actual topology; named scenarios
  (single/dual UPS, power-path loss, cross-path, cooling loss, IT service failures, shared surge)
  and a hold-duration control.
- **Trial replay** — step through the **worst simulated year** on an interactive timeline that
  reconciles to the integrated downtime, with a component-state schematic at each instant.
- **Evidence panel** — any-outage risk interval, SLA-breach risk interval, annual SLA budget,
  unserved energy, and a clear "insufficient evidence" state.
- **Diagnostics** — actual ±50% one-at-a-time rate reruns (tornado chart), independent vs
  common-cause comparison, and a generator-source consistency check (0.58 vs 115/266).
- **Statistics** — normal and conservative bounds, Clopper–Pearson risk intervals, paired CIs,
  p95/p99 downtime, convergence checkpoints.

### Facility operations (supporting context, clearly labelled)
- **Rack floor planner** — place racks, elevation editor, feed A/B/AB, cooling zones, fail a feed/zone/rack.
- **Software stack & threats** — service dependency graph, replica placement, deterministic
  threat propagation (virus/worm/ransomware/misconfiguration/bad-patch), security controls.
- **Resilience assessment** — transparent weighted readiness checklist (not a Tier claim).
- **Facility fault explorer** — graph view + bounded N−1 single-point-of-failure sweep.
- **Capacity calculators** — power, cooling, racks, PUE, WUE, SLA downtime arithmetic.
- **DCIM monitor** — synthetic telemetry stream with threshold alerts (labelled synthetic).

### Cross-cutting
- **Exports** — complete JSON, results CSV, **trial-level CSV**, and a **printable design report** (PDF).
- **Run history** — last 12 runs in IndexedDB, restore and re-run.
- **Reference library** — every rate with source, status (cited vs illustrative) and notes.
- **Methodology page** — equations, interval policy, and explicit modelling boundaries.
- **API documentation** at `/docs`; stateless API; single worker for consistent progress admission.

---

## 6. Why this is defensible (and not "another AI dashboard")

- The **numbers are computed**, not displayed: exact interval integration, renewal sampling,
  train capacity, paired streams — all testable and tested.
- **Reproducibility is a first-class feature**: seed + input fingerprint + dataset version +
  engine version in every export.
- **Honesty is designed in**: mixed-source data is labelled, the generator conflict is shown,
  zero-outage runs are not reported as certainty, and every results screen carries the caveat.
- It has a **real research result** with an **independent analytic cross-check**, not just charts.

---

## 7. Engineering hardening completed in this cycle

A full audit (two independent reviews) was run; the following **confirmed defects were fixed and
regression-tested** (backend suite 53 → **59 passing**; browser suite **8 passing**):

| # | Defect | Fix |
|---|---|---|
| 1 | Malformed service **import** could blank the app | Server validates the whole layout+service bundle before any state change; React **error boundary** added |
| 2 | Duplicate **replica hosts** inflated redundancy | Service model rejects duplicate hosts (422) |
| 3 | Device IDs could **collide across racks** | Layout requires globally unique device IDs |
| 4 | Unrelated threat falsely reported **ransomware data loss** | Data loss now keyed to the hosts ransomware actually reached |
| 5 | Invalid edits kept **stale "healthy" metrics** and persisted bad state | Failed evaluation clears metrics; only server-validated state is persisted |
| 6 | Threats propagated **from an offline origin** | Offline/failed origin and failed hosts excluded from propagation |
| 7 | Dependency **cycles** accepted silently | Cycle detection returns the offending path (422) |
| 8 | Scenario **duration** control disagreed with the run | Duration options now include every recovery/MTTR value |
| 9 | **Mobile overflow** (390 px → 511 px) | Containment CSS + regression test across all 14 pages |
| 10 | "Configuration changed" banner after every run | Key-order-independent config comparison |
| 11 | "Delivered workload" exceeded demand | Display capped at demand (capacity vs served) |
| 12 | Stale inventory regression test | Reconciled to the real 22/25-node designs |
| 13 | Operations **default design failed its own checks** | Default is now N+1-consistent (100/100, zero single points of failure) |
| 14 | Random streams keyed on **file order** | Explicit frozen `stream` ids in the dataset (seeded results byte-identical) |
| 15 | Study **cache reused stale outputs** | Per-run fingerprint validated before reuse |
| 16 | Sidebar engine version hard-coded | Read from `/api/health` |
| 17 | Progress polling **404 spam** after completion | Poll stops on 404 |
| 18 | Empty `react` build chunk / bundle warnings | Chunking fixed (no warnings, no empty chunk) |
| 19 | Dev-only deps in production requirements | Split into `requirements-dev.txt` |
| 20 | Missing `LICENSE`, `CITATION.cff`, CI, Playwright config | Added (CI runs backend tests, build, and the browser suite) |

**Reproducibility guarantee:** the seeded engine output is **byte-identical** to before the
hardening — re-run produced **N 1,889.29 · N+1 5.21 · 2N 5.78 min/yr**, matching the paper.

---

## 8. Honest limitations (say these before the panel asks)

- Failure rates are **mixed-source**: UPS/generator/ATS are secondary-source; PDU, cooling and
  all IT rates are **illustrative**. The generator record is internally inconsistent (0.58 vs 0.433).
  → No field-claimed availability; the *method* is the contribution.
- Tier I–IV percentages are treated as **SLA benchmarks**, not Uptime Institute certification.
- Repairs are perfect and instantaneous failover is assumed; **no** battery autonomy,
  failure-to-start probability, fuel depletion, thermal inertia, transfer/switch delays,
  repair-crew queues, or spare-part delays.
- **No cross-ties** in 2N by design — the N+1-beats-2N result depends on this rule (disclosed).
- Single-failure mode is a controlled baseline, not an independent-failure stochastic model.
- The research engine (10 MW) and the operations design (500 kW) **do not share one canonical
  project state** — they are separate surfaces; a "create experiment from this design" adapter is
  future work.

---

## 9. Roadmap / future scope

- **Cross-tie toggle** for 2N (highest-value model addition).
- **Paper mode preset** — frozen infrastructure-only config + all five scenarios + seeds pooled 30k.
- **Utility/battery/generator dynamics**: utility outages, failure-to-start per demand,
  start/transfer delay, retry limits, fuel exhaustion.
- **Input-uncertainty propagation** — sample λ from a Gamma posterior (generator conflict is 3.7σ).
- **Realistic repairs** — lognormal/Weibull, finite crews, spare delays, priorities.
- **Optional thermal ride-through**; **interval-first comparison charts** (downtime dot plots,
  exceedance curves, architecture×hazard heatmap); **streaming aggregates** to cut the 8.6 MB payload.
- **Unified versioned project model** linking design → scenario → experiment.
- Async job API, headless CLI, shareable URL configs, figure export.

---

## 10. Viva / Q&A preparation

**"Are these real facility numbers?"**
No. Rates are mixed-source and labelled on-screen. We contribute the *method* and its
auditability, not a field measurement.

**"Why is 2N not better than N+1?"**
Because the dominant outage mechanism is a *single-unit* loss, which N+1's spare already covers.
2N only protects against losing a complete train, a rarer event in this configuration, and its
no-cross-tie rule means an A-path + B-path combination can still interrupt service.

**"How do we know the simulator is right?"**
Three ways: (1) exact interval integration is unit-tested against hand-computed cases;
(2) the single-component result matches the analytic renewal reward `λ·MTTR` to within 2.5%;
(3) an independent stationary analytic calculation for N/N+1/2N falls inside our 95% CIs.

**"Why show 'insufficient evidence' instead of a score?"**
Because with zero observed outages a point estimate of 100% is not evidence of perfection.
We report a conservative upper bound instead of a false green.

**"What is actually yours here?"**
The engine design (renewal sampling, exact overlap integration, train-based capacity, paired
streams), the statistical policy (conservative zero-outage bounds, Clopper–Pearson risk intervals),
the provenance model, and the end-to-end reproducibility workflow.

**"Why does the same app contain rack/software/DCIM modules?"**
As engineering context that shows the failure physics in a recognisable facility. They are
explicitly separated from the paper's validated scope and are not used to claim results.

---

## 11. Suggested talk track / time budget (12 min)

| Min | Beat | Screen |
|---:|---|---|
| 0–1 | Problem + one-line pitch | Operations overview |
| 1–5 | Reproduce the paper (N/N+1/2N) | Architecture comparison |
| 5–7 | Break it live (1 UPS vs 2 UPS) | Live failure lab |
| 7–9 | Evidence, statistics, export | Simulation workspace + report |
| 9–11 | Provenance + methodology + operations | Reference library / Methodology |
| 11–12 | Limitations + roadmap + close | — |

Full click-by-click version: `docs/DEMO_SCRIPT.md`.

---

## 12. How a reviewer reproduces everything

```bash
pip install -r requirements.txt
npm ci && npm run build
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000     # http://127.0.0.1:8000

# tests
pip install -r requirements-dev.txt
python -m pytest tests -q              # 59 backend tests
npx playwright test                    # 8 browser tests

# the paper study (writes paper/results/summary.{json,csv})
python paper/run_study.py
```
