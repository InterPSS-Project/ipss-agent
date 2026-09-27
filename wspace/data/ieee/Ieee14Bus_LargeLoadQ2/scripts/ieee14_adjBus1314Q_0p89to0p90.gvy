/**
 * ieee14_adjBus1314Q_0p89to0p90.gvy -- set the Bus13 / Bus14 reactive load so both bus voltages
 * come up into [0.89, 0.90] pu.
 *
 * Values found by ieee14_qv_adjust.gvy on a fresh parse (7 passes, anchor Q13 = 5.8 / Q14 = 5.0 MVAr):
 *
 *     Bus13   Q 50.0 -> 45.5053 MVAr     V13 = 0.89900 pu
 *     Bus14   Q 50.0 -> 21.3202 MVAr     V14 = 0.89100 pu
 *
 * As stored the case is unsolvable (j50.0 MVAr at both buses is past the nose point), which is why
 * Bus14's Q falls so far and Bus13's only a little: the anchor starts from the base IEEE-14 values.
 *
 * Only Q moves -- the MW stays as stored (13.5 / 14.9 MW). IEEE14 is a contribute gen/load model,
 * so the edit goes through getContributeLoad(...).loadCP; assigning bus.loadQ (the aggregate) would
 * not move the case totals.
 *
 * This script only edits the model -- follow with interpss_run_aclf to solve it and write the result
 * files. Run it with reload: true if the held model has already been solved or degraded (a diverged
 * ACLF leaves the generators switched to GenPQ), so the edit starts from the stored case:
 *
 *     interpss_run_gvy({ script: 'ieee14_adjBus1314Q_0p89to0p90.gvy', reload: true })
 *     interpss_run_aclf()
 */

def LOAD_Q = ['Bus13': 0.455053d, 'Bus14': 0.213202d]      // pu Q on the 100 MVA base

LOAD_Q.each { id, q ->
	def load = aclfnet.getBus(id).getContributeLoad(id + '-L1')
	load.loadCP = new Complex(load.loadCP.real, q)
	println id + ' load set to ' + (load.loadCP.real * 100) + ' MW + j' + (q * 100) + ' MVAr'
}
