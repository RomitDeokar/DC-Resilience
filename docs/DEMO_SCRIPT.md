# DC-Resilience — Faculty Demo Script

Audience: project guide / review panel.
Total time: **10–12 minutes** (a 5-minute fast path is marked ⚡).
Run from a single terminal so nothing depends on the internet:

```bash
pip install -r requirements.txt
npm ci && npm run build
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
# open http://127.0.0.1:8000
```

Tip: open the browser at **1440×900**, keep one tab. The app starts on **Operations overview**.

---

## Opening line (say this while the page loads)

> "This is DC-Resilience. It answers one question: *what does redundancy actually buy you?*
> It is a reproducible Monte Carlo reliability engine wrapped in an engineering console.
> Nothing here is a made-up reliability score — every number comes from simulated component
> failures that are integrated over a full year, and every input rate has a cited source."

---

## Part 1 — Orient the panel (1 min)

1. Point at the left sidebar. Read the three groups out loud:
   - **FACILITY OPERATIONS** — design and inspect a facility (Infrastructure designer, Rack floor planner, Software stack & threats, Resilience assessment, Capacity calculators, Facility fault explorer, DCIM monitor).
   - **RELIABILITY RESEARCH** — the research core (Simulation workspace, Live failure lab, Architecture comparison, Run history).
   - **RESOURCES** — Reference library, Methodology, API documentation.
2. Bottom-left shows the live engine version (read from `/api/health`, not hard-coded).

> "The research core is the paper. The operations modules are supporting context —
> I'll show them briefly at the end and be explicit about which parts are the contribution."

---

## Part 2 — Reproduce the paper's headline result (4 min) ⚡

**Goal:** show N vs N+1 vs 2N under identical random streams.

1. Click **Architecture comparison** (RELIABILITY RESEARCH).
2. Click **Configure experiment** (top-right of the workspace).
3. In **Servers & IT services**, **untick** *"Include IT service failures"*.
   > "This matches the paper's scope: the published study is infrastructure-only."
4. Leave everything else at defaults: 10,000 trials, 1 year, seed 42, islanded mode.
5. Click **Run comparison**. Watch the progress panel: it streams **real** completed-trial
   counters ("measured at completed batches"), not a fake timer.
6. When results appear, read the three architecture cards:

| Architecture | Expected annual downtime | Interpretation |
|---|---:|---|
| **N** | ≈ 1,880–1,890 min/yr | one failed UPS takes the site down |
| **N+1** | ≈ 5 min/yr | one spare absorbs a single failure |
| **2N** | ≈ 6 min/yr | two independent trains — *not* better than N+1 here |

> "Over three seeds and 10,000 trials each, the pooled means are
> **N = 1,889.29, N+1 = 5.21, 2N = 5.78 minutes/year** — exactly the paper's numbers.
> The interesting result is that 2N is not better than N+1 in this model, because 2N is
> only required to survive a *complete* train loss; a single unit loss inside one train
> creates a short outage that N+1 already covers with one spare."

7. Scroll to **Is the difference supported by the sample?** — the paired-difference table.
   > "These are paired trial differences using shared random streams, with confidence
   > intervals. We do not claim a winner from a point estimate alone."

**If time is short:** run **quick** instead of baseline from the preset menu ("Load a preset → Quick check · 1,000 trials") — same shape, ~2 seconds.

---

## Part 3 — Make it fail live (2 min) ⚡

1. Click **Live failure lab**.
2. Click **Single UPS failure**.
   - Schematic shows **Service maintained**; **Surviving capacity 10,000 kW**.
   > "N+1 absorbs one failure. Nothing happens to the customer."
3. Click **Dual UPS failure**.
   - Status flips to **Capacity degraded**; **Surviving capacity 7,500 kW**; **IT capacity lost 2,500 kW**;
     the delivered-workload gauge caps at demand.
   > "Two simultaneous failures exhaust the spare. 7,500 kW of a 10,000 kW load survives —
   > 2,500 kW of service is lost. This is the moment the panel should remember."
4. Click **Restore all**.
5. (Optional, 2N only) Switch power/cooling to 2N first, then try **Cross-path failure**
   (UPS in path A + PDU in path B) — it still fails, because each path must be *complete*.

> Key teaching point: *the app never pools capacity across disconnected power trains.*

---

## Part 4 — Show the evidence, not just the answer (2 min)

1. Back on the **Simulation workspace**, run one **Research baseline** experiment
   (preset → "Research baseline · 10,000 trials", then **Run experiment**).
2. Point at, in order:
   - **Estimated availability** KPI and the **evidence badge** ("Mean CI above benchmark" /
     "Insufficient outage evidence"). > "We refuse to show green when the sample is too small."
   - The **Evidence panel**: any-outage risk interval, SLA-breach risk interval, annual SLA budget.
   - **Trial distribution** tab: the histogram now shows **outage years only** (the huge no-outage
     count is reported as a number, so the rare severe bars are actually visible), plus an
     **exceedance curve** — "the chance a year exceeds X minutes of downtime" — with the SLA budget line.
   - **Event samples** tab: individual failure events with cause, time, capacity and service effect.
   - **Trial replay** tab: press **Play replay** and point out the **time-proportional** pacing
     (quiet periods are long, failure bursts are fast) with **1× / 4× / 16×** speed; scrub or use
     **Next replay event**. > "Every replay reconciles to the same integrated downtime."
   - **Architecture comparison** downtime chart: note the **log scale with 95% CI whiskers** —
     N is hours while N+1 and 2N are minutes, so the trade-off is visible instead of three identical bars.
3. Click **Export report** → show the four outputs: complete JSON, results CSV, trial-level CSV,
   and the **printable design report** (Print / Save as PDF).
   > "A reviewer can reproduce every number from the exported configuration, dataset version and input fingerprint."

---

## Part 5 — Supporting operations modules (2 min)

Keep this brisk; label them clearly as engineering context, not the paper.

1. **Operations overview** / **Resilience assessment**:
   - Click **Resilience assessment**. Show the **readiness score (100/100)** and the checklist.
   > "The default design is internally consistent: a default that fails its own checks would be embarrassing."
2. **Facility fault explorer**: run the built-in **single-point-of-failure sweep** — removes each
   component in turn and lists which ones break service (N−1 screening).
3. **Rack floor planner**: place racks, edit elevation, feed (A/B/AB) and cooling zone; fail a feed
   and watch affected racks go offline.
4. **Software stack & threats**: release a **worm** with segmentation on/off and show that an
   **offline origin cannot propagate** (our hardening).
5. **DCIM monitor**: synthetic telemetry stream with threshold alerts (clearly labelled synthetic).

---

## Part 6 — Data provenance and honesty (1 min) ⚡

1. Click **Reference library**. Point at the two record classes:
   **Cited secondary source** (UPS, generator, ATS from Wiboonrat 2020 / IEEE 493) vs
   **Illustrative · unverified** (PDU, cooling, IT).
2. Read the **generator audit**: printed **0.58/year** vs **115 ÷ 266 = 0.43233/year**.
   > "The published row is internally inconsistent. We expose both and let the sensitivity
   > analysis compare them instead of hiding the conflict."
3. Click **Methodology** — show the equations, the confidence-interval policy, and the
   explicit "modelling boundaries" list.

---

## Closing statement

> "The contribution is not the dashboard. It is a **reproducible, auditable reliability
> calculation**: exact outage integration, train-based capacity, paired random streams,
> conservative statistics when evidence is thin, and a full provenance trail. The operations
> modules exist to show the same failure physics in a facility a reviewer can recognise."

---

## Contingency notes

- If a run is slow, use the **quick** preset (1,000 trials) — the qualitative result is identical.
- If the browser storage warning appears, it is expected in private windows; exports still work.
- If asked "is this real facility data?" — answer **no**: rates are mixed-source and the UI says so
  on every results screen. The *method* is the contribution, not the numeric inputs.
- Numbers shown are seed-dependent. The pooled three-seed means (below) are the paper's:
  **N 1,889.29 · N+1 5.21 · 2N 5.78 min/year** (95% CIs in the presentation notes).
