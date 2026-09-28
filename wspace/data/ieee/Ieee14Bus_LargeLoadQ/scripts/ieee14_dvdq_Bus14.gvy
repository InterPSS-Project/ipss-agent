// Ieee14Bus_LargeLoadQ — dV/dQ sensitivity at Bus14 and the load-Q band that
// puts V(Bus14) inside the [0.89, 0.90] pu target window.
// See docs/load-q-adjustment.md, Example A, and the $ipss-case-aclf-adjust skill.
//
// WHY: this case schedules Bus14 with an unusually large reactive load
// (14.9 MW + j50.0 MVAr). The solved voltage at Bus14 is ~0.871 pu, the only
// bus below 0.90. To size a corrective Q reduction we need the local
// voltage/reactive stiffness dV(Bus14)/dQ(Bus14).
//
// HOW: SenAnalysisType.QVOLTAGE is the linearised dV/dQ taken from the B''
// network — dV(monitorBus)/dQ(injectBus), pu voltage per pu reactive
// INJECTION (so dVdQ > 0 here: injecting Q raises the bus voltage). The self
// term dV(Bus14)/dQ(Bus14) is the diagonal entry, so reaching a target V needs
//     dQinject = (targetV - V0) / dVdQ          [pu injection, positive]
//     Qload    = Qload0 - dQinject              [the load moves the other way]
//
// ACCURACY: B'' is a linearisation and ignores reactive losses, so it
// understates the stiffness of a deeply depressed bus. Here it returns
// 0.4437 pu/pu, while the AC finite difference measured by solving the case
// at Q = 0.50 and Q = 0.49 pu gives
//     (0.877732 - 0.871352) / 0.01 = 0.638 pu/pu   (~1.4x)
// and falls to ~0.52 pu/pu as the bus recovers toward 0.90 pu. Treat the
// window printed below as a first cut / ranking aid, then confirm the applied
// value with a real AC load flow — that is what
// ieee14_adjBus14Q_0p89to0p90.gvy and its iteration table do.
//
// The sensitivity is topology/admittance based (reproducible); the base voltage
// printed is the operating point of the held model, so run this on a solved
// case (after interpss_run_aclf) for a meaningful window.

busId = "Bus14";
loadId = "Bus14-L1";
vLow = 0.89;                     // window, pu
vHigh = 0.90;

bus = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);

v0 = bus.voltageMag;               // solved value when the held case is solved
q0 = load.loadCP.imaginary;        // pu on the 100 MVA base
p0 = load.loadCP.real;

dVdQ = senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, busId, busId);

// Load-Q that lands on each edge of the window. dV/dQ > 0 means more injection
// (less load Q) raises V, so the 0.90 edge needs the SMALLER load Q.
qForHigh = q0 - (vHigh - v0) / dVdQ;   // load Q giving V = 0.90 (lower edge)
qForLow  = q0 - (vLow  - v0) / dVdQ;   // load Q giving V = 0.89 (upper edge)
qMid     = 0.5 * (qForLow + qForHigh);

println "Bus14 dV/dQ sensitivity"
println "  base load          : " + (p0 * 100.0) + " MW + j" + (q0 * 100.0) + " MVAr"
println "  base voltage       : " + v0 + " pu"
println "  dV(Bus14)/dQ(Bus14): " + dVdQ + " pu/pu (B'' linearised)"
println "  dQ/dV              : " + (1.0 / dVdQ) + " pu/pu"
println "  target window      : " + vLow + " .. " + vHigh + " pu"
println "  first-cut load Q   : " + (qForLow * 100.0) + " MVAr (V=" + vLow + ")" +
        " .. " + (qForHigh * 100.0) + " MVAr (V=" + vHigh + ")"
println "  window midpoint    : " + (qMid * 100.0) + " MVAr"

return "dV/dQ(Bus14) = " + dVdQ + " pu/pu; first-cut load Q window = " +
       (qForLow * 100.0) + " .. " + (qForHigh * 100.0) + " MVAr"
