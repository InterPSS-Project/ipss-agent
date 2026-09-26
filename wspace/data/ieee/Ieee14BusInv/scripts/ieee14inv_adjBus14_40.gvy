// Ieee14BusInv — relieve the Bus14 convergence problem.
//
// The case as shipped schedules Bus14 at 80 MW / 40 MVAr; with the 132/33 kV
// transformer that net cannot be solved (ACLF stalls with a large dP at Bus14).
// This script trims the Bus14 load to 40 MW + j30 MVAr.
//
// Loads are held in pu on the 100 MVA system base, so
//   40 MW + j30 MVAr  ==  new Complex(0.40, 0.30)
//
// IEEE 14 is a contribute gen/load model (net.isContributeGenLoadModel()), so the
// edit goes through the contribute load: bus.loadP (the aggregate) does not move
// the case totals on this model.
busId = "Bus14";
loadId = "Bus14-L1";
loadP = 0.40;
loadQ = 0.30;

bus = aclfnet.getBus(busId);
load = bus.getContributeLoad(loadId);
load.loadCP = new Complex(loadP, loadQ);
