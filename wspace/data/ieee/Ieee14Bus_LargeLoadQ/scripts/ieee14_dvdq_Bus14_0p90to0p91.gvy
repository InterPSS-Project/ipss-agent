// Ieee14Bus_LargeLoadQ — dV/dQ sensitivity at Bus14 and the FIRST-CUT load-Q band
// that would put V(Bus14) inside the [0.90, 0.91] pu target window.
// See docs/load-q-adjustment.md, Example A, and the $ipss-case-aclf-adjust skill.
//
// This is the [0.90, 0.91] sibling of ieee14_dvdq_Bus14.gvy (which sizes the
// [0.89, 0.90] window):
//   * the band sits HIGHER, so it needs LESS reactive load (bigger Q reduction);
//   * the B'' linearisation is even more optimistic this far from the base point,
//     so treat the window printed below as a first cut only and size the applied
//     value from AC solves at the current operating point.
//
// WHY: this case schedules Bus14 with an unusually large reactive load
// (14.9 MW + j50.0 MVAr) and solves at V(Bus14) ~ 0.871 pu. The corrective control
// is the local voltage/reactive stiffness dV(Bus14)/dQ(Bus14).
//
// HOW: SenAnalysisType.QVOLTAGE is the linearised dV/dQ taken from the B''
// network — dV(monitorBus)/dQ(injectBus), pu voltage per pu reactive
// INJECTION (so dVdQ > 0: injecting Q raises the bus voltage). The self term is
// the diagonal entry, so a target V needs
//     dQinject = (targetV - V0) / dVdQ          [pu injection, positive]
//     Qload    = Qload0 - dQinject              [the load moves the other way]
//
// The sensitivity is topology/admittance based (reproducible); the base voltage
// printed is the operating point of the held model, so run this on a solved case
// (after interpss_run_aclf) for a meaningful window.

busId = "Bus14";
loadId = "Bus14-L1";
vLow = 0.90;                     // window, pu
vHigh = 0.91;

bus = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);

v0 = bus.voltageMag;               // solved value when the held case is solved
q0 = load.loadCP.imaginary;        // pu on the 100 MVA base
p0 = load.loadCP.real;

dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, busId, busId);

// Load-Q that lands on each edge of the window. dV/dQ > 0 means more injection
// (less load Q) raises V, so the 0.91 edge needs the SMALLER load Q.
qForHigh = q0 - (vHigh - v0) / dVdQ;   // load Q giving V = 0.91 (lower end of the Q window)
qForLow  = q0 - (vLow  - v0) / dVdQ;   // load Q giving V = 0.90 (upper end of the Q window)
qMid     = 0.5 * (qForLow + qForHigh);

println "Bus14 dV/dQ sensitivity (target " + vLow + " .. " + vHigh + " pu)"
println "  base load          : " + (p0 * 100.0) + " MW + j" + (q0 * 100.0) + " MVAr"
println "  base voltage       : " + v0 + " pu"
println "  dV(Bus14)/dQ(Bus14): " + dVdQ + " pu/pu (B'' linearised)"
println "  dQ/dV              : " + (1.0 / dVdQ) + " pu/pu"
println "  target window      : " + vLow + " .. " + vHigh + " pu"
println "  first-cut load Q   : " + (qForLow * 100.0) + " MVAr (V=" + vLow + ")" +
        " .. " + (qForHigh * 100.0) + " MVAr (V=" + vHigh + ")"
println "  window midpoint    : " + (qMid * 100.0) + " MVAr"

return "dV/dQ(Bus14) = " + dVdQ + " pu/pu; first-cut load Q window for [" + vLow + ", " + vHigh + "] = " +
       (qForLow * 100.0) + " .. " + (qForHigh * 100.0) + " MVAr"
