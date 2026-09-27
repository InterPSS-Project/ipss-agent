/**
 * ieee14_dvdq_matrix.gvy -- dV/dQ sensitivity matrix at Bus13 / Bus14
 * Case: data/ieee/Ieee14BusLargeLoadQ2/ieee14.ieee   (100 MVA base)
 *
 * Two matrices are reported, because they answer different questions.
 *
 * 1. REFERENCE matrix, from the InterPSS SenAnalysisAlgorithm bound to this script as
 *    `senAlgo`: for QVOLTAGE it factorizes the B'' (Q-V) matrix of the fast-decoupled
 *    load flow and solves it for a unit reactive injection, giving
 *
 *        M[f][t] = dV(bus_t) / dQinjection(bus_f)      [pu V / pu Q, 100 MVA base]
 *
 *    It is built from the network as it currently stands -- branch admittances,
 *    in-service status, and above all the current PV/PQ bus types, so a generator
 *    Q-limit conversion (PV -> PQ) moves it -- but it linearizes the Q-V relation at
 *    V ~ 1.0 pu. It needs no solved case.
 *
 * 2. OPERATING-POINT matrix, measured by finite differences on the solved case:
 *    perturb one load Q, solve the AC load flow with the case config, divide the
 *    voltage response by the perturbation, restore. This is the matrix that actually
 *    drives the voltages where the case is running, and it is the one
 *    ieee14_qv_adjust.gvy steps on. It is only printed when the model is solved.
 *
 *    J[r][c] = dV(bus_r) / dQload(bus_c)             [pu / pu]   (negative)
 *
 * The two agree near V ~ 1.0 pu and separate as the case stresses: on this case
 * |dV(Bus13)/dQ| is ~0.09 at 1.05 pu and ~0.50 at 0.90 pu, against 0.117 (all-PV
 * network) to 0.373 (generators pinned at their Q limits) for the reference matrix.
 *
 * The model is left as it was found: the probe restores Q and the solved voltages and
 * re-solves. Nothing is written to disk.
 */

def BUSES    = ['Bus13', 'Bus14']          // the two reactive-load buses of interest
def EPS      = 0.010d                      // pu Q perturbation for the finite-difference probe
def f5 = { d -> String.format('%10.5f', d) }
def f6 = { d -> String.format('%12.6f', d) }
def f3 = { d -> String.format('%7.3f', d) }
def mat = { A -> '[' + f6(A[0][0]) + ' ' + f6(A[0][1]) + '; ' + f6(A[1][0]) + ' ' + f6(A[1][1]) + ']' }
def inv2 = { A ->
	double d = A[0][0] * A[1][1] - A[0][1] * A[1][0]
	[[A[1][1] / d, -A[0][1] / d], [-A[1][0] / d, A[0][0] / d]]
}
def matrixOf = { rows -> [rows[0] as double[], rows[1] as double[]] }

// ------------------------------------------------- 1. reference matrix M
// M[f][t] = dV(bus_t) / dQinjection(bus_f); row = injection bus, col = voltage bus
def M = matrixOf(BUSES.collect { f -> BUSES.collect { t -> senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, f, t) } })
def Mdet = M[0][0] * M[1][1] - M[0][1] * M[1][0]
def Minv = inv2(M)

println '======================================================================'
println ' dV/dQ sensitivity matrix -- bus 13 / bus 14'
println '======================================================================'
println ''
println ' 1. REFERENCE matrix: M[f][t] = dV(bus_t) / dQinjection(bus_f)     [pu/pu, 100 MVA]'
println '    (SenAnalysisType.QVOLTAGE -- B"" matrix of the current network, linearized at V~1.0)'
println ''
println '                    dV(Bus13)     dV(Bus14)'
println '   dQ(Bus13)   ' + f6(M[0][0]) + '    ' + f6(M[0][1])
println '   dQ(Bus14)   ' + f6(M[1][0]) + '    ' + f6(M[1][1])
println ''
println '    per MVAr of injection [pu / MVAr]'
println '   dQ(Bus13)   ' + f6(M[0][0] / 100) + '    ' + f6(M[0][1] / 100)
println '   dQ(Bus14)   ' + f6(M[1][0] / 100) + '    ' + f6(M[1][1] / 100)
println '    determinant = ' + f6(Mdet) + '   symmetric = ' + (Math.abs(M[0][1] - M[1][0]) < 1e-12)
println ''
println '    inverse, dQinjection/dV [pu/pu]   ' + mat(Minv)
println '    inverse, dQinjection/dV [MVAr/pu] ' + mat([[Minv[0][0] * 100, Minv[0][1] * 100], [Minv[1][0] * 100, Minv[1][1] * 100]])
println ''
println '    reading: +1 MVAr of injection at Bus14 raises V(Bus14) by ' + f5(M[1][1] / 100) +
		' pu and V(Bus13) by ' + f5(M[0][1] / 100) + ' pu; +1 MVAr of load does the opposite.'
println ''

// ------------------------------------- 2. operating-point matrix J (solved case)
def Jop = [[-M[0][0], -M[0][1]], [-M[1][0], -M[1][1]]]   // load convention, from the reference
if (aclfnet.isLfConverged()) {
	// same two-tier config rule as the interpss_run_aclf tool: case folder, else project default
	def codeLoc = org.interpss.agent.bridge.IpssAgentBridge.class.protectionDomain.codeSource.location
	def root = new java.io.File(codeLoc.toURI())
	while (root != null && !new java.io.File(root, 'wspace/data/ieee/Ieee14BusLargeLoadQ2').isDirectory()) {
		root = root.parentFile
	}
	def cfgFile = new java.io.File(root, 'wspace/data/ieee/Ieee14BusLargeLoadQ2/config/aclf_run.json')
	if (!cfgFile.isFile()) {
		cfgFile = new java.io.File(root, 'config/aclf_run.json')
	}
	def cfg = org.interpss.plugin.aclf.config.AclfRunConfigRec.loadAclfRunConfig(cfgFile.absolutePath)
	def solveLf = {
		def algo = com.interpss.core.LoadflowAlgoObjectFactory.createLoadflowAlgorithm(aclfnet)
		cfg.configAclfRun(algo, cfg.polarCoordinate, cfg.includeAdjustments, false)
		boolean ok
		try {
			ok = algo.loadflow()
		} catch (Exception e) {
			return false
		}
		return ok && aclfnet.isLfConverged()
	}
	def active = aclfnet.getBusList().findAll { it.isActive() }
	def snapV = { -> def m = [:]; active.each { b -> m[b.id] = [b.voltageMag, b.voltageAng] }; m }
	def restoreV = { m -> m.each { id, va -> def b = aclfnet.getBus(id); b.voltageMag = va[0]; b.voltageAng = va[1] } }
	def loadOf = { id -> aclfnet.getBus(id).getContributeLoad(id + '-L1') }
	def qOf = { id -> (double) loadOf(id).loadCP.imaginary }
	def setQ = { id, q -> def l = loadOf(id); l.loadCP = new Complex(l.loadCP.real, q) }
	def vOf = { id -> (double) aclfnet.getBus(id).voltageMag }

	def v0 = BUSES.collect { vOf(it) }
	def J = [[0d, 0d], [0d, 0d]]
	def how = []
	BUSES.eachWithIndex { id, c ->
		def qSave = BUSES.collect { qOf(it) }
		def vSave = snapV()
		setQ(id, qSave[c] + EPS)
		if (solveLf()) {
			def vp = BUSES.collect { vOf(it) }
			BUSES.eachWithIndex { bid, r -> J[r][c] = (vp[r] - v0[r]) / EPS }
			how << 'measured'
		} else {
			J[0][c] = -M[0][c]           // fall back to the reference matrix (load convention)
			J[1][c] = -M[1][c]
			how << 'reference (probe did not solve)'
		}
		BUSES.eachWithIndex { bid, i -> setQ(bid, qSave[i]) }
		restoreV(vSave)
		solveLf()
	}
	def Jdet = J[0][0] * J[1][1] - J[0][1] * J[1][0]
	def Jinv = inv2(J)
	Jop = J

	println ' 2. OPERATING-POINT matrix at the solved state, by finite difference (dQ = ' +
			String.format('%.1f', EPS * 100) + ' MVAr):      ' + how.join(', ')
	println '    J[r][c] = dV(bus_r) / dQload(bus_c)   [pu/pu]'
	println ''
	println '                    dV(Bus13)     dV(Bus14)     |  V now'
	println '   dQload(Bus13)' + f6(J[0][0]) + '    ' + f6(J[0][1]) + '     |  ' + f5(v0[0])
	println '   dQload(Bus14)' + f6(J[1][0]) + '    ' + f6(J[1][1]) + '     |  ' + f5(v0[1])
	println ''
	println '    per MVAr of load Q [pu / MVAr]'
	println '   dQload(Bus13)' + f6(J[0][0] / 100) + '    ' + f6(J[0][1] / 100)
	println '   dQload(Bus14)' + f6(J[1][0] / 100) + '    ' + f6(J[1][1] / 100)
	println '    determinant = ' + f6(Jdet)
	println ''
	println '    inverse, dQload/dV [pu/pu]   ' + mat(Jinv)
	println '    inverse, dQload/dV [MVAr/pu] ' + mat([[Jinv[0][0] * 100, Jinv[0][1] * 100], [Jinv[1][0] * 100, Jinv[1][1] * 100]])
	println ''
	println '    stepping rule:  dQload = inv(J) @ (V_measured - V_target)'
} else {
	println ' 2. OPERATING-POINT matrix: not available -- the model is not solved.'
	println '    Run interpss_run_aclf (or ieee14_qv_adjust.gvy) first; the reference matrix above'
	println '    needs no solution.'
}

println ''
println '----------------------------------------------------------------------'
println ' load Q currently held by the model'
BUSES.each { id ->
	def q = aclfnet.getBus(id).getContributeLoad(id + '-L1').loadCP.imaginary
	println '   ' + id + '  Qload = ' + f6(q) + ' pu = ' + f5(q * 100) + ' MVAr'
}
println ' model solved: ' + aclfnet.isLfConverged()
println '======================================================================'

'ieee14_dvdq_matrix: reference dV/dQinj ' + mat(M) + ' ; operating-point dV/dQload ' + mat(Jop) +
		' (pu/pu, rows=Bus13,Bus14)'
