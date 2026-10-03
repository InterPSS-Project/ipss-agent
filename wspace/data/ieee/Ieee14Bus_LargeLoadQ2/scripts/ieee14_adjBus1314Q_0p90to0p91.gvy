// Ieee14Bus_LargeLoadQ2 — apply the Bus13 / Bus14 reactive loads that put BOTH buses
// inside the [0.90, 0.91] pu window, in one shot.
// See docs/load-q-adjustment.md, Example B', and the $ipss-case-aclf-adjust skill.
//
// Result: Bus13-L1 13.5 MW + j50.0 MVAr -> 13.5 MW + j47.33 MVAr
//         Bus14-L1 14.9 MW + j50.0 MVAr -> 14.9 MW + j17.51 MVAr
// Only the reactive parts change; both P values are untouched.
// Verified: V(Bus13) = 0.904929 pu, V(Bus14) = 0.904935 pu at those Q values — both inside
// [0.90, 0.91], ~0.005 pu clear of each edge, and no bus below 0.90.
//
// This is the [0.90, 0.91] sibling of ieee14_adjBus1314Q_0p89to0p90.gvy (which applies the
// 45.5053 / 21.3202 MVAr pair for the [0.89, 0.90] band). The band sits one tenth higher, so both
// buses shed more reactive load, and the split between them is not proportional: Bus13 keeps 47.3
// of its 50 MVAr while Bus14 drops to 17.5, because the two buses are strongly coupled — the
// measured Jacobian's cross terms (-0.37) are ~0.76 of its self terms (-0.49 / -0.54), which is
// exactly why a scalar dV/dQ cannot size this pair.
//
// The values come from ieee14_qv_adjust_0p90to0p91.gvy, which anchors at the plain IEEE-14 loads
// (the stored base Q13 = Q14 = 50.0 MVAr does NOT converge — it is past the nose point) and then
// takes 8 damped Newton passes on a finite-difference Jacobian re-measured at each operating point:
//
//   pass  Q13, Q14 (MVAr)   V13, V14 (pu)          note
//   ----  ---------------   ---------------------  ----------------------------------------
//   start    5.80,  5.00    1.05038, 1.03553       anchor — the plain IEEE-14 loads, flat start
//      1    26.86,  8.84    1.00867, 1.00217       far: voltage move capped at 0.020 pu
//      4    40.50, 15.06    0.96526, 0.96095
//      6    45.36, 16.89    0.92303, 0.92154       local: cap tightens to 0.006 pu
//      8    47.33, 17.51    0.904929, 0.904935    converged, max |V - target| = 7.1e-5 pu
//
// The rounded values below (0.4733 / 0.1751 pu) were re-run and land at V13 = 0.904972 pu and
// V14 = 0.904975 pu — 4e-5 pu above the adjuster's exact point, still ~0.005 pu inside each edge.
//
// ALWAYS run this with reload: true. The AC load flow mutates the held model through its control
// adjustments, so a reparse per solve keeps the pipeline reproducible.
//
// IEEE14 is a contribute gen/load model, so the edit goes through the contribute loads:
// bus.loadP / bus.loadQ (the aggregates) do not move the case totals on this model.
def LOAD_IDS = ['Bus13': 'Bus13-L1', 'Bus14': 'Bus14-L1']
def LOAD_P = ['Bus13': 0.135, 'Bus14': 0.149]      // MW/100 — untouched
def LOAD_Q = ['Bus13': 0.4733, 'Bus14': 0.1751]    // MVAr/100 — the adjusted reactive loads

['Bus13', 'Bus14'].each { id ->
	def load = aclfnet.getBus(id).getContributeLoad(LOAD_IDS[id])
	load.loadCP = new Complex(LOAD_P[id], LOAD_Q[id])
}
