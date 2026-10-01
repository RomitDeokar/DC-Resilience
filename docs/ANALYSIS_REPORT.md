# DC-Resilience: Repository Audit and Improvement Plan

Audit date: 2026-10-01 · Commit audited: `7960107` · Paper: *DC_Resilience_FINAL_IEEE_Paper.pdf*

Severity scale: **P0** gives wrong results or breaks the build or tests · **P1** is a visible bug or misleading output · **P2** affects quality, maintainability or UX · **P3** is polish.

---

## 1. Summary

The core of the project is strong. The engine does exact event integration, keeps the A/B power trains separate instead of pooling them, uses paired random streams and Clopper–Pearson intervals, and records input fingerprints. That is more rigorous than most student projects, and the paper matches what the code does.

The "looks AI-generated" feel comes from three things:

1. **The frontend source is effectively minified.** For example, `App.tsx` is 39 KB in 213 lines, with single lines up to 3,400 characters; `operations.css` has one 20,900-character line. Nobody writes code like this, so reviewers will spot it immediately.
2. **The UI copy is defensive.** Almost every widget has a disclaimer: "not a quote", "not Tier certification", "illustrative", "not a forecast". The caveats are honest, but repeating them 30+ times reads like an LLM covering itself. Real engineering tools state assumptions once, in one place.
3. **The visual language is generic.** It uses the "SaaS template" look: eyebrow labels in tracked caps, big thin numbers, pastel badges, and taglines like "Test your design against the unexpected" or "Engineering fundamentals, without the guesswork". The simulation itself is never shown animating. Results appear all at once after a spinner.

There is also scope creep. Rack planner, malware propagation, DCIM telemetry, PUE/WUE calculators and INR budgets sit next to a paper that covers only infrastructure N / N+1 / 2N. Each one dilutes the research story.

---

## 2. Bugs found

### Fixed in this PR

| # | Sev | Bug | Root cause | Fix |
|---|-----|-----|-----------|-----|
| B1 | P1 | The **"Configuration changed. Results below belong to the previous experiment"** banner appears right after every run, so it always shows. | `App.tsx` compared `JSON.stringify(config)` with `JSON.stringify(run.config)`. The API returns keys in Pydantic field order (`…simulation, it, maintenance, budget`), but `DEFAULT_CONFIG` uses a different order (`…it, maintenance, budget, simulation`). | Added a key-order-independent `stableJson()` in `types.ts`. |
| B2 | P1 | The schematic shows **"Delivered IT workload 10,833 / 10,000 kW"**. You can't deliver more than the demand. | `surviving_capacity_kw` is capacity, not delivered load. With 13 server nodes at 833.3 kW each, IT capacity exceeds the load. | Display `min(capacity, demand)`. |
| B3 | P0 | **The test suite fails** (`test_operations_scenarios_and_sweep_match_applied_design`: `assert 22 == 24`). The paper says "All 41 existing regression tests passed". | The default `Design` changed but the hard-coded count wasn't updated. | Corrected to 22 with an explanatory comment. 53/53 pass. |

### Open bugs (not fixed yet)

| # | Sev | Area | Description and suggested fix |
|---|-----|------|---------------------------|
| B4 | P1 | Engine, multi-year | `annual_downtime_ci95 = (100 - ci) * 5256` is correct only for 1-year trials, while the means are annualised separately. Check consistency for `simulated_years_per_trial > 1`, or compute the CI directly from `annual_minutes`. |
| B5 | P1 | Engine, initial condition | All units start healthy at t=0, so the 1-year results are *transient* and **understate** stationary unavailability, especially for generators (MTTR 25.7 h). Add a warm-up period or stationary initialisation (sample the initial state with probability `q_g`). The paper lists this as future work; it's about 10 lines of code. |
| B6 | P1 | Engine, OS stream | `OS` hazards reuse the `SERVER` component id. The engine reference-counts causes per `cid`, so an OS crash plus a hardware failure on the same node counts as one unit down, which is correct. But `failures['OS']` counts events while `failure_breakdown` labels them as an independent component class, which overstates "events" in the breakdown chart (64,641 OS crashes dominate it). Label them as "software restarts" or show them separately. |
| B7 | P1 | Engine, `single` mode | `single_failure_events` drops *all* overlapping starts site-wide, including on unrelated units, and is applied after common-cause events are appended. That's guarded by the validator, but the "controlled baseline" is not a standard reliability construct. Remove it or document it as a pedagogical toggle. |
| B8 | P1 | API payload | `/api/compare` returns **4.3 MB** of JSON (30,000 `trial_results` rows plus full topology ×3); `/api/simulate` returns 1.4 MB. Each run is also stored in IndexedDB (12 runs ≈ 50 MB). Return per-trial arrays only on request (e.g. `?trials=true`), or as compact typed arrays, and compute paired deltas on the server (already done). |
| B9 | P1 | API / progress | The frontend keeps polling `/api/progress/{id}` after the job ends and gets **404**, which is the console error on every run. Stop polling when the POST resolves, or have the server return `{status:'done'}` for recently finished jobs. |
| B10 | P1 | API, blocking | `experiment()` is a sync `def`, so FastAPI runs it in the threadpool. That's fine, but the `BoundedSemaphore(2)` plus a 429 response means a third user just gets an error. Use a job queue (`POST` returns job id, `GET /result/{id}`), which also fixes B9 and allows cancellation. There is currently **no cancel button** for long runs. |
| B11 | P2 | Comparison UI | "Planning budget breakdown" `<details>` panels render as unstyled bare text lines (three in a row on the comparison page) with large gaps. |
| B12 | P2 | Comparison UI | The availability bar chart uses a **truncated y-axis** (99.50–100%), which makes N look like zero. Plot downtime (log scale) or unavailability instead, as the paper's Fig. 9 does. |
| B13 | P2 | Simulation page | The page layout is capped at about 1000 px, leaving a large empty right column at 1440 px. The KPI strip and schematic don't use the available width. |
| B14 | P2 | Mobile | On a 390 px viewport the schematic overflows horizontally and the header crowds. |
| B15 | P2 | Results, replay | The worst-trial replay is a flat line with a single spike and almost nothing visible. It needs a zoom-to-event window, component swim-lanes (Gantt) and play/pause. |
| B16 | P2 | e2e tests | `tests/demo.spec.ts` relies on old selectors (`Compare architectures` button navigation flow) and is not wired to any script or CI. There is **no CI** (`.github/workflows` missing). |
| B17 | P2 | Lab scenarios | The "Cross-path failure" quick scenario is permanently disabled for non-2N configs with no explanation tooltip. |
| B18 | P2 | Config | The tier list maps tiers to fixed percentages (`TIERS = {I: 99.671…}`). The paper explicitly says Uptime removed these in 2009. Rename it to "SLA benchmark" in the UI/API (`tier_target` → `sla_benchmark`) to match the paper. |
| B19 | P2 | Data | `generator_rate_basis='count_exposure'` hard-codes `115/266` in `engine.py`. Move it to `failure_rates.json` as an `alternative_rate` field so provenance stays data-driven. |
| B20 | P2 | Repo hygiene | `DC_Resilience_IEEE_Report_revised.docx` (245 KB binary) is committed at the repo root. `paper/results/` (referenced by the paper as the supplementary archive) is **not** in the repo, so the study isn't actually reproducible from the repo alone. Commit the pooled CSV plus hashes, or a script that regenerates them, and add a `make paper` target. |
| B21 | P2 | Build | Vite warns that the main chunk is 600 KB, and the `react` manual chunk is empty ("Generated an empty chunk: react"). Lazy-load the Operations/Facility pages with `React.lazy`, and fix the `manualChunks` config. |
| B22 | P3 | Deps | `requirements.txt` pins versions that are newer than those in the sandbox (`numpy==2.5.3`, `fastapi==0.141.1`) but uses no lock or hash. Starlette warns that `httpx` with `TestClient` is deprecated. |
| B23 | P3 | Branding | `index.html` favicon is orange (`#ef6c39`) while the app theme is dark green, so the branding is inconsistent. |

---

## 3. Simulation and modelling improvements

These are ranked by impact on research credibility. Each also maps to a "Limitations" item in your paper.

1. **Stationary or warm-up initialisation** (B5). Cheap to add and removes a known bias.
2. **Input-uncertainty propagation.** Sample λ from a Gamma posterior (e.g. Gamma(failures+0.5, exposure)) for each *outer* replicate, then run the inner Monte Carlo. Report a two-level interval. This turns "tight sampling CIs don't imply real confidence" from a disclaimer into a measured result. It's the single biggest upgrade for the paper.
3. **Non-exponential repair.** Add lognormal MTTR (keep the mean, add σ). Heavy-tailed repairs are what actually hurt N+1. This is a one-line change in `event_batches` (`rate['mttr_hours']` → sampled).
4. **Repair crew constraint.** Add a single repair queue with *k* crews. Overlaps become more likely, which is realistic.
5. **Generator failure-to-start** (per-demand probability) together with **utility outages** (Poisson grid loss with duration distribution). That makes `utility` mode meaningful. Right now generators are either "always running" or "ignored", and neither matches real sites.
6. **Rare-event efficiency.** For 2N/N+1, only about 0.6% of trials have outages. Use importance sampling (failure biasing) or conditional MC to get tighter CIs from the same CPU budget.
7. **Vectorised trial evaluation.** `evaluate_events` is pure Python per trial (about 3.5 s for 10k trials). Most trials have no capacity deficit, so skip trials where no group ever drops below required units (a NumPy pre-check). That gives a 10–50× speed-up, makes 100k-trial runs interactive and allows live streaming.
8. **Analytical cross-check in the UI.** Show the closed-form steady-state unavailability (k-out-of-n with `q_g = λr/(8760+λr)`) next to the Monte Carlo estimate for the independent case. The paper already derives `3q² vs 4q²`, so put it on screen. It's an instant credibility signal.
9. **Sensitivity tornado chart.** The ±50% reruns already exist. Render them as a proper tornado chart instead of a table.
10. **Seeds and replicates.** The paper uses 3 seeds, but the UI runs 1. Add a "replicates" field and show per-seed spread, which matches the paper's Fig. 13.

---

## 4. UI/UX redesign: making it look professional

### 4.1 Cut scope to match the paper

Restructure into **three workspaces**, matching the paper's sections:

| Keep and polish | Move to an "Extras" tab or remove |
|---|---|
| Design (topology and inputs) | Rack floor planner |
| Inject (deterministic failure lab) | Software stack & malware threats |
| Simulate (Monte Carlo, live) | DCIM synthetic telemetry |
| Compare (N / N+1 / 2N and scenarios) | PUE / WUE calculators |
| Data & Methods (rates, provenance, notes) | INR planning budget |

The rack planner and malware model are decent work but unrelated to the paper's contribution. Reviewers will ask why they're there.

### 4.2 Visual language

- **Use one typeface and tabular numerals.** Inter or IBM Plex Sans for UI, plus `font-variant-numeric: tabular-nums` for all metrics, and JetBrains Mono for IDs (`UPS-A01`).
- **Use a semantic colour palette and nothing else.** Neutral greys, one accent, and status colours (healthy green, degraded amber, outage red, under-repair blue). Use one colour per architecture consistently everywhere: N = slate, N+1 = blue, 2N = violet. Right now N+1 is orange in one chart and green in another.
- **Use a dense, engineering-tool layout** (think Grafana, ETAP, SKM, Datadog) instead of a landing-page layout. Smaller headings, more data per screen, full-width grids, and a sticky left config panel with results on the right.
- **Remove the marketing taglines** ("Test your design against the unexpected", "Same load. Different resilience.", "Open source. Reproducible.") and use plain descriptive titles.
- **Put disclaimers in one place.** A single "Model assumptions" drawer, plus one footnote line on exports. Remove the 30+ inline "not a quote / not certification" fragments.
- **Add a dark mode.** Control-room style tools are usually dark; it's cheap with CSS variables.

### 4.3 Make the simulation look alive

The current simulation is a button, a spinner, and then a wall of numbers. Suggested replacements:

1. **Live convergence streaming.** Stream batch results over WebSocket or SSE every 256 trials. Animate the running mean downtime and CI band narrowing in real time, and show a live counter: trials, outages found, failure events, overlaps.
2. **Animated single-line diagram.** A proper electrical one-line: Utility/Gen → ATS → UPS → PDU → Load, with A/B trains side by side for 2N. Draw power flow as animated dashes along edges. When a unit fails, its edge turns red, flow reroutes to the spare, and the load bar dips if capacity is lost.
3. **Trial replay as a Gantt chart.** One swim-lane per component, red bars for failure-to-repair, a shaded band where served load < demand, and a step chart of served kW underneath, plus a play/scrub control that drives the one-line diagram. Pick "worst trial", "a random outage trial" or "a typical trial".
4. **Distribution charts.** Use a log-scale histogram or CCDF ("P(downtime > x)") for annual downtime per architecture, overlaid. This is the most informative reliability chart and the paper's Fig. 8 already argues for it.
5. **Comparison page.** Use a forest plot of paired differences (like paper Fig. 5), log-scale downtime bars with CI whiskers (Fig. 9), and stacked failure-composition bars (Fig. 10), so the app and paper show the same figures.
6. **Scenario matrix.** Show a heat-map table of architectures × scenarios (nominal, 20× stress, bank hazard, site hazard, generator audit), with cells showing mean downtime and a CI-resolved marker. This is the paper's Table VI, made interactive.

### 4.4 Code quality, which also affects how reviewers see the project

- Format the whole frontend with **Prettier** and add **ESLint** (`npm run lint`). This alone removes most of the "generated" impression.
- Split `App.tsx` (about 40 state hooks) into page components and a small store (Zustand or `useReducer` plus context).
- Merge the four overlapping CSS files (`styles.css`, `refresh.css`, `operations.css`, `facility.css`, 140 KB total with `!important` overrides) into **one token-based stylesheet**, or adopt Tailwind.
- Split `MODEL_NOTES` (17 paragraph-long strings in `engine.py`) into a structured `assumptions.json` with `id`, `category` and `text` fields.
- Add GitHub Actions: `pytest`, `tsc`, `eslint`, `vite build` and Playwright smoke tests on every PR.
- Rewrite the README with an architecture diagram, a screenshot or GIF, "Reproduce the paper" steps and a citation block.

---

## 5. Paper and code consistency

| Paper claim | Code status |
|---|---|
| "All 41 regression tests passed" | Suite has 53 tests, and 1 was failing before this PR. Update the count in the paper. |
| Supplementary archive with per-run JSON and pooled CSV | `paper/results/` not committed. |
| Engine 2.3.0, dataset `2026-09-12-audited-assumptions-v2` | Matches. |
| Fig. 4 shows the UI | Should be re-captured after the redesign. |
| Tier-free SLA wording | UI still says "Tier III target" and "Target tier" in config. |

---

## 6. Suggested roadmap

| Phase | Work | Effort |
|---|---|---|
| 1 · Hygiene | Prettier/ESLint, CI, fix B4/B8/B9/B11, commit study results | 1–2 days |
| 2 · Scope | Restructure navigation into Design / Inject / Simulate / Compare / Methods; move extras behind a toggle | 1 day |
| 3 · Visual system | Tokens, typography, palette, layout grid, dark mode | 2–3 days |
| 4 · Live simulation | Streaming progress, animated one-line diagram, Gantt replay, CCDF | 3–4 days |
| 5 · Modelling | Warm-up, lognormal repair, input-uncertainty outer loop, analytical cross-check | 3–5 days |
| 6 · Paper | Re-run the study, update figures, test count and Fig. 4 | 1 day |
