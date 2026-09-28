// Ieee14Bus_LargeLoadQ — trim the Bus14 reactive load so V(Bus14) lands inside
// the [0.89, 0.90] pu window.
// See docs/load-q-adjustment.md, Example A, and the $ipss-case-aclf-adjust skill.
//
// Result: Bus14 load 14.9 MW + j50.0 MVAr  ->  14.9 MW + j46.0 MVAr.
// Only the reactive part changes; P is untouched.
// Verified: V(Bus14) = 0.895243 pu at 14.9 MW + j46.0 MVAr.
//
// Sizing. The B''-based dV/dQ from ieee14_dvdq_Bus14.gvy is 0.4437 pu/pu, which
// linearly implies a load-Q window of 43.5 .. 45.8 MVAr for [0.90 .. 0.89] pu.
// That estimate is too optimistic — B'' ignores reactive losses, and the AC
// finite difference on this case is ~0.638 pu/pu near the base falling to
// ~0.52 pu/pu near 0.90 — so the steps below are AC secants from real solves.
// Every row is measured on this case with a fresh reparse per solve
// (interpss_run_gvy reload: true, then interpss_run_aclf, reading Bus14 VoltMag
// from result/ieee14_DF_bus.csv):
//
//   Q (MVAr)  V(Bus14) pu  how
//   --------  -----------  --------------------------------------------------
//   50.00     0.871352     base case (Bus14 is the only bus below 0.90)
//   49.00     0.877732     finite-difference probe for the AC dV/dQ
//   45.51     0.897791     secant from the 50.00 / 49.00 pair
//   45.13     0.899754     secant from the 49.00 / 45.51 pair
//   45.00     0.900423     just above the window (over-corrected)
//   46.00     0.895243     applied  <-- inside [0.89, 0.90]
//
// The AC-measured window for [0.89, 0.90] pu is about 45.1 .. 46.9 MVAr, i.e.
// ~3.1 .. 4.9 MVAr of reactive load shed; 46.0 MVAr sits at its midpoint, which
// leaves margin on both edges of the window.
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
loadQ = 0.460;   // 46.0 MVAr

bus = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
