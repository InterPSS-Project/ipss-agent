// Ieee14BusInv — relieve the Bus14 convergence problem.
//
// The case as shipped schedules Bus14 at 80 MW / 40 MVAr; with the 132/33 kV
// transformer that net cannot be solved (ACLF stops at dP 0.00234 pu @ Bus14
// with the case's maxIterations: 25). This script trims the load to
// 50 MW + j30 MVAr.
//
// Loads are held in pu on the 100 MVA system base, so
//   50 MW + j30 MVAr  ==  new Complex(0.50, 0.30)
//
// IEEE 14 is a contribute gen/load model (net.isContributeGenLoadModel()), so the
// edit goes through the contribute load: bus.loadP (the aggregate) does not move
// the case totals on this model.
busId = "Bus14";
loadId = "Bus14-L1";
loadP = 0.50;
loadQ = 0.30;

bus = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
