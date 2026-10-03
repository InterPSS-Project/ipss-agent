// Ieee14Bus_LargeLoadQ — trim the Bus14 reactive load so V(Bus14) lands inside
// the [0.90, 0.91] pu window.
// See docs/load-q-adjustment.md, Example A, and the $ipss-case-aclf-adjust skill.
//
// Result: Bus14 load 14.9 MW + j50.0 MVAr  ->  14.9 MW + j44.1 MVAr.
// Only the reactive part changes; P is untouched.
// Verified: V(Bus14) = 0.905016 pu at 14.9 MW + j44.1 MVAr — the band midpoint,
// 0.005 pu clear of each edge.
//
// This is the [0.90, 0.91] sibling of ieee14_adjBus14Q_0p89to0p90.gvy: the band
// sits one tenth higher, so the load sheds ~1.9 MVAr more.
//
// Sizing. The B''-based dV/dQ is 0.4437 pu/pu (ieee14_dvdq_Bus14_0p90to0p91.gvy),
// which linearly implies a load-Q window of 41.3 .. 43.5 MVAr for [0.91 .. 0.90] pu.
// That is too optimistic again — B'' ignores reactive losses — and the error grows
// with the distance from the base point: the AC stiffness at this operating point
// is 0.507 pu/pu, so the AC window is 43.11 .. 45.08 MVAr. Every row below is
// measured on this case with a fresh reparse per solve (interpss_run_gvy
// reload: true, then interpss_run_aclf, reading Bus14 VoltMag from
// result/ieee14_DF_bus.csv):
//
//   Q (MVAr)  V(Bus14) pu  how
//   --------  -----------  --------------------------------------------------
//   50.00     0.871352     base case (Bus14 is the only bus below 0.90)
//   45.00     0.900423     AC probe — the 0.90 edge is just below this
//   43.20     0.909548     AC probe — the 0.91 edge is just above this
//   44.10     0.905016     applied  <-- inside [0.90, 0.91], at its midpoint
//
// The AC-measured window for [0.90, 0.91] pu is about 43.11 .. 45.08 MVAr, i.e.
// ~4.9 .. 6.9 MVAr of reactive load shed; 44.1 MVAr sits at its midpoint.
//
// ALWAYS run this with reload: true. The AC load flow mutates the held model
// through its control adjustments (PV/PQ limit switching, discrete and tap
// control), so repeated solves on a held model drift from the fresh-parse
// solution. A reparse per solve keeps the pipeline reproducible.
//
// IEEE14 is a contribute gen/load model (net.isContributeGenLoadModel()), so
// the edit goes through the contribute load: bus.loadP / bus.loadQ (the
// aggregates) do not move the case totals on this model.
busId = "Bus14";
loadId = "Bus14-L1";
loadP = 0.149;   // 14.9 MW
loadQ = 0.441;   // 44.1 MVAr

bus = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
