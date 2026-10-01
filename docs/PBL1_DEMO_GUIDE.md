# DC-Resilience: PBL1 Evaluation Guide

Authors: Romit Deokar (RA2411003010615) and Shourya Saran (RA2411003010628), SRM IST.
This guide covers the project explained from zero, a click-by-click demo script, a spoken pitch, and likely viva questions.
Every demo step below was run against this repository in a real browser, and the numbers quoted are what the app produced.
Screenshots are in `docs/shots/`.

---

## 1. The project in plain English

**Problem.** Data centres put spare equipment in so that one failure does not turn the lights off. The labels for this are **N, N+1 and 2N**. People often assume that a bigger label means a fixed uptime. That is wrong, and Uptime Institute removed expected-downtime figures from its Tier Standard in 2009. A label does not say how the equipment is wired, how long repairs take, or what happens when one event knocks out several units together.

**Our answer.** We built **DC-Resilience**. It is a simulator that *breaks equipment at random, for thousands of simulated years*, and counts how often the data centre actually loses service. This method is called **Monte Carlo failure injection**.

**The three architectures** (a 10 MW data centre, so 10,000 kW of IT load):

| Label | Meaning | Analogy |
|---|---|---|
| **N** | Exactly the equipment needed. No spare. | Car with no spare tyre |
| **N+1** | Needed equipment plus one spare in each group (UPS, generator, PDU, ATS, cooling). One shared train. | Car with one spare tyre |
| **2N** | Two complete, separate power/cooling trains (A and B). Either one alone can carry the load. | Two cars |

**Equipment in the model:** UPS (battery backup), generators, PDU (power distribution unit), ATS (automatic transfer switch), CRAC (cooling units).

**How the simulation works (one trial = one simulated year):**
1. Every component starts healthy.
2. Each one fails at random times. Failure times follow an **exponential distribution** with the component's failure rate λ (failures/year).
3. Each failure takes a fixed repair time (MTTR) to fix, and the component is then healthy again.
4. Repairs of different units can overlap in time. That overlap is how redundancy gets defeated.
5. At every moment the program computes the capacity still being served: `S(t) = min(L, Power(t), Cooling(t))`.
6. If `S(t) < L` (10,000 kW), that time counts as **downtime**. The program integrates it exactly with no time steps, and overlapping outages are not double-counted.
7. Repeat for 10,000+ trials per design and average the results.

**Key idea that makes the model realistic ("capacity-preserving"):** a 2N design cannot mix parts of train A with parts of train B. If UPS-A01 and PDU-B01 fail, then A has lost UPS capacity and B has lost distribution capacity. Neither train is whole, so 7,500 kW is served. A naive model that pools all healthy parts would wrongly say "fully available". The paper calls this out and tests it.

---

## 2. What the paper found

Facility: 10 MW load, 450,000 simulated facility-years in total, 3 independent random seeds per scenario.

| Scenario | N (min/yr) | N+1 | 2N | Take-away |
|---|---|---|---|---|
| Nominal (independent failures) | 1,889 | **5.21** | **5.78** | Both redundant designs cut downtime by about 99.7%. N+1 vs 2N is **statistically unresolved**, because the confidence interval [-1.75, +0.62] crosses zero. |
| 20x stress (failure rates x20) | 36,127 | **1,671** | 2,267 | N+1 beats 2N, because 2N's separate trains cannot pool spares. |
| Bank-A shared hazard | 1,914 | 29.9 | **5.9** | 2N wins, because the B train survives a train-A event. |
| Site-wide shared hazard | 1,914 | 29.9 | 30.5 | Both are hurt. Spares cannot protect against a site-wide event. |
| Generator source audit | 1,433 | 2.79 | 2.72 | One conflicting number in the source table moves the absolute results a lot. |

**Headline message:** no single architecture always wins. The answer depends on the topology, on the hazard scope (bank-local or site-wide), on data provenance, and on the uncertainty. Redundancy labels alone are not enough.

**Honest limitations** (state these yourself before the examiner asks):
- Results are scenario studies, not a field-calibrated forecast.
- Two of the five failure-rate classes (PDU and CRAC) are illustrative assumptions.
- The generator rate in the source table is internally inconsistent: 0.58/yr is printed, but 115 failures over 266 unit-years gives 0.432/yr. We report both.
- Repair times are fixed, failover is ideal, and there is no standby failure and no grid-connected mode.
- No Tier certification is claimed.

---

## 3. Before the demo: set-up checklist

Do this 15 minutes before you present. Have the app running **before** the examiner sits down.

```bash
cd DC-Resilience                       # your cloned repo
pip install -r requirements.txt        # Python backend deps
npm ci && npm run build                # builds the React frontend into dist/
uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Open **http://localhost:8000** in Chrome at full screen (zoom 100%).

Check the health URL: `http://localhost:8000/api/health` should show `"status":"ok"`.

Optional but recommended: run `python -m pytest tests -q`. Expect **53 passed** in about 11 seconds. The paper says 41 tests, because the repo has grown since the paper was written, so say "53 now".

Docker alternative: `docker compose up --build` (also serves on port 8000).

**Backup plan if the live demo breaks:** keep `docs/shots/` open in a folder, and keep the PDF paper open on another tab.

> Important: the app has two halves. The sidebar section **FACILITY OPERATIONS** (top) is an extra operations console with a small 500 kW demo facility. The paper is about the **RELIABILITY RESEARCH** section (bottom): Simulation workspace, Live failure lab, Architecture comparison. Spend most of the demo time there.

---

## 4. Demo script, every click (about 8 to 10 minutes)

### Step 0: Landing page (30 s)
- The app opens on **Operations overview**. Say: "This is the console. The top group is facility operations tooling. The bottom group, Reliability Research, is the core of our paper."
- Point to the amber banner that appears on research pages: *"Assumption-based research demo... No Tier certification claim."* Say that honesty about assumptions is built into the UI.

### Step 1: Live failure lab, the intuitive hook (2 min)
1. Left sidebar, under RELIABILITY RESEARCH, click **Live failure lab**.
2. You see a dependency diagram: Generators, Transfer switches, UPS modules, Power distribution, Cooling, and IT services. The default is N+1 at 10,000 kW.
3. Click **Single UPS failure**. Result: surviving capacity 10,000 kW, impact **Protected**. Say: "One spare absorbs it."
4. Click **Dual UPS failure**. Result: surviving **7,500 kW**, lost 2,500 kW (25%), impact **Interrupted**, "240 min downtime if held for 4 h". Say: "Two failures in a one-spare group exceed the redundancy."
5. Click **Restore all** (top right of the lab panel).
6. Now show 2N. Click **Configure experiment** (right side), open the **Load a preset...** dropdown and choose **Independent paths · 2N**. Click **Close configuration**.
7. Click **Power path A outage**. Result: **Protected** at 10,000 kW (the whole A train is down and B carries the load). This is the 2N strength.
8. Click **Cross-path failure** (it is greyed out for N+1 and active for 2N). This fails UPS-A01 and PDU-B01. Result: **7,500 kW, Interrupted**. Say: "This is the key insight of the paper. The healthy parts exist, but they are on different trains, so you cannot combine them. Naive models miss this."
9. Optional: click **Site-wide UPS + generator surge** to show a common-cause event taking out everything (0 kW).
10. Click **Restore all** again.

Note: the lab is a deterministic what-if, not a probability. The simulation in Steps 2 and 3 gives probabilities.

### Step 2: Simulation workspace, one design (1.5 min)
1. Click **Simulation workspace**.
2. Click **Configure experiment** (it expands the settings). Show: facility name, target tier, IT load 10,000 kW, power/cooling redundancy toggles (N / N+1 / 2N), trials, years per trial, failure mode.
3. In the **Load a preset...** dropdown choose **Quick check · 1,000 trials**. Click **Close configuration**.
4. Click **Run experiment** (green button). A toast says "Simulation complete · 1,000 trials in ~0.5 s". Scroll down to the results dashboard: availability, annual downtime, SLA breach rate, confidence intervals, distribution charts.
5. Optional: there is a **Trial replay** tab where you can step through the failure events of one simulated year, and an **Export report** menu (JSON, CSV, trial CSV, printable PDF).

### Step 3: Architecture comparison, the main result (3 min). This is the most important slide.
1. Click **Architecture comparison**.
2. Click **Configure experiment**. **Uncheck "Include IT service failures"** (this matches the paper, which covers infrastructure only). The Trials selector should show 10,000 (default). Click **Close configuration**.
3. Click **Run comparison** (top, next to Configure experiment). It takes about 4 seconds.
4. Read out the three cards. Expect something like this (10,000 trials, seed 42; your numbers should match, since the seed is fixed):

   | | N | N+1 | 2N |
   |---|---|---|---|
   | Availability | 99.6440% | 99.9990% | 99.9989% |
   | Downtime/yr | 1,871 min | 5.07 min | 5.82 min |
   | Installed components | 16 | 21 | 32 |
   | SLA breach rate | 79.4% | 0.56% | 0.87% |

   Say: "N fails the 99.982% SLA benchmark in about 80% of years. Both redundant designs fix that."
5. Scroll to the table **"Is the difference supported by the sample?"** Point at the row **N+1 to 2N: -0.752 min, CI -2.824 to 1.319, "Difference unresolved"**. Say: "The tool refuses to claim a winner between N+1 and 2N, because the confidence interval crosses zero. A lot of studies would just rank them by the point estimate."
6. Point at the component count: 16 vs 21 vs 32. N+1 achieves almost the same result with about 1.3x the equipment, versus 2x for 2N.
7. Say that the numbers differ slightly from the paper's table (1,889 / 5.21 / 5.78), because the paper pools 30,000 trials across 3 seeds, while the demo shows 10,000 trials from 1 seed. The pattern is the same.

### Step 4: Show the scenarios that change the answer (2 min, optional but impressive)
Still on **Architecture comparison**, with the panel open from **Configure experiment** and "Include IT service failures" still unchecked:
1. Expand **Dependency & maintenance experiments** (small triangle, left side) and tick **Add common-cause failures**. In the **Affected UPS + generator units** dropdown, leave **All units in bank A**. Click **Compare architectures** (green button at the bottom of the panel). Expected downtime: N+1 about 29.6 min, **2N about 5.9 min**. 2N wins, because train B survives an event on train A.
2. Change the **Affected UPS + generator units** dropdown to **All units across A and B** and click **Compare architectures** again. Expected: N+1 about 29.6, **2N about 30.3**. Both are hurt, since nothing protects against a site-wide event.
3. (Slower, about 20 s) Untick **Add common-cause failures**. Click **Advanced settings** (under Simulation parameters, top right of the panel) and set **Failure stress** to 20. Click **Compare architectures**. Expected: N 36,100 / N+1 1,668 / **2N 2,277**. N+1 is better.
4. Say: "One framework, four different conclusions, depending on the hazard assumptions. That is the point of the paper."

I clicked through these exact steps in a real browser (10,000 trials, seed 42) and the app returned: bank N 1,895.5 / N+1 29.55 / 2N 5.87; site N 1,895.5 / N+1 29.55 / 2N 30.30; stress N 36,100.5 / N+1 1,668.3 / 2N 2,277.4.


### Step 5: Reproducibility and rigor (30 s)
- Open **Export report** and show JSON, CSV and the printable report. Say: "Every run records the seed, engine version, dataset version and a fingerprint of the inputs."
- Mention `paper/run_study.py`, which recomputes all paper results from the repo.
- Mention 53 automated tests, including hand-checkable cases such as the "[1,5) and [3,7) overlap = 6 h, not 8 h" case.

### Step 6: Close (15 s)
Click **Reference library** (bottom of the sidebar) to show where each failure rate came from and which ones are marked illustrative. Then give your conclusion line (see the end of the pitch).

---

## 5. The pitch (read or paraphrase, about 5 minutes)

**Opening (30 s)**
"Good morning, sir/madam. Our project is DC-Resilience, a Monte Carlo failure-injection framework for evaluating data centre redundancy architectures. The motivating observation is simple. When people say a data centre is N+1 or 2N, they treat it as if it directly gives you an uptime number. It doesn't. Uptime Institute itself removed expected downtime from its Tier Standard in 2009."

**Problem (30 s)**
"Real availability depends on how the equipment is wired, how long repairs take, whether failures overlap, and whether one event can take out several units at once. A label can't capture all that. We needed a way to measure it."

**What we built (60 s)**
"DC-Resilience is a web application with a Python FastAPI backend running a NumPy continuous-time simulation, and a React and TypeScript frontend. It simulates a 10 MW facility with UPS, generators, PDUs, transfer switches and cooling. Each component fails at random using an exponential lifetime, gets repaired after a fixed repair time, and repairs can overlap. We compute exact downtime and unserved energy, with no time-step approximation, and report confidence intervals. We compare N, N+1 and 2N using paired random streams, which means that the same random failures are applied to corresponding units in each design. That reduces noise, so differences between architectures are real, not luck."

**Technical contribution (45 s)**
"Three things make it more careful than a simple calculator. First, capacity-preserving topology. A 2N design has two disconnected trains and cannot pool a healthy UPS from train A with a healthy distribution unit from train B. Naive pooling would overstate availability, so we model it correctly and verify it with hand-checkable test cases. Second, explicit data provenance. Three of our five failure-rate classes come from IEEE Std 493 via a secondary source. The other two, PDU and cooling, we label as illustrative assumptions. Third, statistical honesty. We report exact Clopper-Pearson intervals for outage probabilities and paired intervals for differences."

**Results (75 s)**
"We ran 450,000 simulated facility-years. Under nominal independent failures, annual downtime is about 1,889 minutes for N, 5.2 for N+1 and 5.8 for 2N. So both redundant designs cut downtime by about 99.7%. But the difference between N+1 and 2N is statistically inconclusive, because the confidence interval includes zero. Then it gets interesting. Under 20x stress, N+1 actually beats 2N, because pooled spares are more flexible than separate trains. With a shared hazard on one power bank, 2N wins, 5.9 versus 29.9 minutes, because the second train survives. With a site-wide hazard, both are hurt, and spares can't help. And one inconsistent number in the source table for generators changes absolute results by about 25%."

**Conclusion (30 s)**
"So our conclusion is methodological. There is no universally best architecture. Any availability claim must come with the topology, the hazard scope, the data provenance and the confidence limits. DC-Resilience provides a reproducible, open-source way to do that. We're clear about limitations: this is a scenario study, not a calibrated forecast, and no Tier certification is claimed. Future work includes real incident-log calibration, repair-time distributions and grid-connected modelling. Thank you. I'd like to show you a live demo now."

---

## 6. Likely viva questions and answers

| Question | Answer |
|---|---|
| What is Monte Carlo simulation? | Repeating a random experiment many times and averaging, to estimate a quantity that is hard to compute analytically. Here each trial is one random simulated year. |
| Why exponential distribution for failures? | It is memoryless and the standard constant-failure-rate model for random failures in reliability engineering (IEEE 493 style data). Limitation: no ageing or infant mortality. |
| What is λ and MTTR? | λ = failure rate per year. MTTR = mean time to repair (fixed hours here). |
| Difference between N, N+1, 2N? | See table in section 1. N = no spare, N+1 = one spare per group in one train, 2N = two complete independent trains. |
| Is N+1 or 2N better? | It depends. Nominal: no resolved difference. High stress: N+1. Bank-local shared hazard: 2N. Site-wide: neither. |
| Why is 2N sometimes worse in your results? | Its two trains are disconnected, so partial capacity from each cannot be combined, and it has more equipment (32 vs 21 units), so more failure events. |
| What is availability and the 99.982% number? | Availability = (T - downtime)/T. 99.982% is the commonly quoted Tier III style benchmark, equal to 94.6 minutes per year. We use it only as an SLA benchmark, not as certification. |
| What is common-cause failure? | One event that disables several units together (e.g. shared fuel, shared fault). We model it as Poisson events (1/yr, 10% accepted, 4 h recovery). These are assumed, not measured. |
| Why paired random streams? | The same random draws are used for matching components across architectures, so the difference between designs has much less noise. |
| What is the Clopper-Pearson interval? | An exact confidence interval for a binomial proportion (e.g. the probability of an SLA breach). |
| How did you validate the simulator? | Hand-checkable deterministic cases (Table I), overlap-union cases, a 100,000-realisation renewal check against λr within 2.5%, and 53 automated tests. |
| Where do the failure rates come from? | UPS, generator and ATS from Wiboonrat (2020), quoting IEEE Std 493. PDU and CRAC are illustrative. The generator entry is internally inconsistent (0.58 vs 0.432 per year), so we run both. |
| Is this a real forecast? | No. It is a reproducible scenario study. We say so explicitly. |
| What are the limitations? | Illustrative rates for 2 of 5 classes, fixed repair times, ideal failover, no standby failure, islanded mode (no utility grid), simple shared-hazard model, all units start healthy. |
| What is novel? | Not the Monte Carlo algorithm (a prior tool exists: Lei and Huang 2017). The contribution is the capacity-aware topology, paired streams, provenance tracking and uncertainty reporting in one inspectable web workflow. |
| Tech stack? | React 19 + TypeScript + Vite + Recharts + React Flow frontend. FastAPI + NumPy + SciPy backend. Docker supported. pytest and Playwright for testing. |
| Why does unserved energy matter? | Downtime minutes cannot tell a partial loss (7.5 of 10 MW) from a total blackout of equal length. Energy (kWh) can. |
| Future work? | Calibrate against real incident logs, repair-time distributions, grid-connected mode with generator start failure, importance sampling for rare events, a cost model. |

---

## 7. Things that can go wrong, and what to say

- **Your numbers differ slightly from the paper.** Expected. The demo uses 10,000 trials and 1 seed, and the paper pools 30,000 trials across 3 seeds. Say "same pattern, within Monte Carlo noise", and point to the confidence intervals.
- **N+1 shows 40 components, not 21.** You forgot to untick "Include IT service failures". That adds an IT layer that is outside the paper's scope. Untick it in Configure experiment.
- **The configuration panel is not visible.** It is collapsed by default. Click **Configure experiment**.
- **The 20x stress run takes about 20 s.** Normal. Talk through the slide while it runs.
- **Browser looks stale after a rebuild.** Hard refresh (Ctrl+Shift+R).
- **Examiner asks "is 2N always the safest?"** Answer with Step 4. It depends on the hazard scope.
- **Examiner points out the PDU/CRAC rates are made up.** Agree. They are labelled illustrative in the paper, in Table II and in the app's warning banner. The paper's claim is the framework and the method, not the absolute numbers.
- **The paper says 41 tests, but you ran 53.** The repo has more tests than the manuscript counted. Say so openly.

## 8. One-line summary to memorise

> "Redundancy labels don't give uptime. We built a reproducible Monte Carlo framework showing that N+1 versus 2N depends on the topology, the hazard scope, the data quality and the confidence limits, and we report all of those together."
