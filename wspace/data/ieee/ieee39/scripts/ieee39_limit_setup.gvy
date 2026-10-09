// ieee39 — apply sample P-gen limits and branch MVA ratings used by
// org.interpss.optadj.ieee39.IEEE39_Sample_Data / sample.ieee39.IEEE39_Sample_Info.
//
// Clears zero-P contribute gens, then:
//   Bus39-G1  P limit [0, 10.0] pu
//   Bus38-G1  P limit [0,  8.3] pu
//   all other gens  P limit [0, 7.0] pu
//   every branch ratingMva1 = 600 MVA (basecase loading limit)
//
// Absolute assignments — safe to re-run. ALWAYS use reload: true if the held
// model may already carry prior OPF/ACLF mutations.

import org.interpss.numeric.datatype.LimitType

aclfnet.busList.each { bus ->
	if (bus.genP == 0.0) {
		bus.contributeGenList.clear()
	}
}

gens = 0
aclfnet.createAclfGenUIDLookupTable(true).values().each { gen ->
	if (gen.name == "Bus39-G1")
		gen.pGenLimit = new LimitType(10.0, 0.0)
	else if (gen.name == "Bus38-G1")
		gen.pGenLimit = new LimitType(8.3, 0.0)
	else
		gen.pGenLimit = new LimitType(7.0, 0.0)
	gens++
}

branches = 0
aclfnet.branchList.each { branch ->
	branch.ratingMva1 = branch.isLine() ? 600.0 : 800.0
	branches++
}

return gens + " gens limited; " + branches + " branches @ 600 MVA"
