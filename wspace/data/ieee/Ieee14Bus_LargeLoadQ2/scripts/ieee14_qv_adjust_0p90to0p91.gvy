/**
 * ieee14_qv_adjust_0p90to0p91.gvy -- move the Bus13 / Bus14 load Q so both voltage magnitudes land
 * inside [0.90, 0.91] pu (target: the band MIDPOINT 0.905 for both -- nothing here asks to maximise
 * load, so the midpoint is the safe target; the [0.89, 0.90] corner variant is ieee14_qv_adjust.gvy).
 *
 * Why this differs from the [0.89, 0.90] run: the band sits one tenth higher, so both buses shed
 * reactive load instead of one being pressed against a corner, and the coupled 2x2 step matters
 * just as much -- raising Q13 lowers V14 and vice versa, which a scalar dV/dQ cannot see.
 *
 * The case's own base (Q13 = Q14 = 50.0 MVAr) does NOT converge (max mismatch ~0.010 pu at Bus9),
 * so this script anchors at the plain IEEE-14 loads first, exactly as the [0.89, 0.90] one does.
 *
 * Case: data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee   (100 MVA base)
 *
 * Method
 *   0. because the stored base is past the nose point, the run starts from a known solvable anchor
 *      (ANCHOR_Q, the plain IEEE-14 load Q) with a flat start, and Newtons from there.
 *   1. `senAlgo` (SenAnalysisType.QVOLTAGE) gives the network-parameter dV/dQ matrix at its
 *      V ~ 1.0 pu linearization point -- printed for reference and used as the fallback column
 *      whenever a finite-difference probe cannot be solved.
 *   2. because that matrix is a poor model once the case is stressed, the adjuster re-measures the
 *      dV/dQ matrix AT THE CURRENT OPERATING POINT by finite differences: perturb one load Q by
 *      EPS, solve the AC load flow, divide the voltage response by EPS, restore, repeat for the
 *      other bus. That 2x2 matrix
 *        J[r][c] = dV(bus_r) / dQload(bus_c)      [pu / pu]   (negative)
 *      is the one the Newton step uses.
 *   3. step:  dQload = -inv(J) @ (V_measured - V_target), capped so the predicted voltage move
 *      stays inside the band width, applied through a line search that only accepts a step which
 *      lowers max|V - target|; a step that will not solve is rolled back and halved.
 *   4. each pass logs the measured response, i.e. the empirical dV/dQ actually realized.
 *
 * Solves use the case config (config/aclf_run.json) through the same LoadflowAlgorithm the
 * interpss_run_aclf tool uses, so the state left behind is the one a following `interpss_run_aclf`
 * writes to the result CSVs. The model is left solved at the target; the bridge-held case is edited
 * in place and the .ieee file on disk is not touched.
 *
 * Written for the DSH bridge tokens (`aclfnet`, `senAlgo`, `Complex` pre-imported).
 */

// ------------------------------------------------------------------ inputs
def BUSES    = ['Bus13', 'Bus14']
def LOAD_IDS = ['Bus13': 'Bus13-L1', 'Bus14': 'Bus14-L1']
def TARGET   = [0.905d, 0.905d]        // pu, in BUSES order -- the [0.90, 0.91] band midpoint
def BAND     = [0.900d, 0.910d]        // the window both buses must end up inside
def ANCHOR_Q = [0.058d, 0.050d]        // pu -- base IEEE-14 load Q, a known solvable start
def EPS_FAR  = 0.020d                  // pu Q perturbation for the Jacobian probe, far from target
def EPS_NEAR = 0.010d                  // pu Q perturbation for the Jacobian probe, near target
def FAR      = 0.020d                  // pu, "far from the target" threshold
def V_CAP_FAR  = 0.020d                // pu, cap on the predicted voltage move when far away
def V_CAP_NEAR = 0.006d                // pu, cap once the Newton step is local
def V_TOL    = 0.0025d                 // pu, accepted |V - target|
def ALPHA    = 1.0d                    // Newton step scaling before the line search
def MAX_ITER = 30
def MAX_BACKTRACK = 8

// --------------------------------------------------- locate the case config
def codeLoc = org.interpss.agent.bridge.IpssAgentBridge.class.protectionDomain.codeSource.location
def root = new java.io.File(codeLoc.toURI())
while (root != null && !new java.io.File(root, 'wspace/data/ieee/Ieee14Bus_LargeLoadQ2').isDirectory()) {
	root = root.parentFile
}
if (root == null) {
	throw new IllegalStateException('cannot locate the ipss-agent project root from ' + codeLoc)
}
def cfgFile = new java.io.File(root, 'wspace/data/ieee/Ieee14Bus_LargeLoadQ2/config/aclf_run.json')
if (!cfgFile.isFile()) {
	cfgFile = new java.io.File(root, 'config/aclf_run.json')
}
def cfg = org.interpss.plugin.aclf.config.AclfRunConfigRec.loadAclfRunConfig(cfgFile.absolutePath)

// ------------------------------------------------------------------ helpers
def solveLf = {
	def algo = com.interpss.core.LoadflowAlgoObjectFactory.createLoadflowAlgorithm(aclfnet)
	cfg.configAclfRun(algo, cfg.polarCoordinate, cfg.includeAdjustments, false)
	boolean ok
	try {
		ok = algo.loadflow()
	} catch (Exception e) {
		return false
	}
	if (!ok || !aclfnet.isLfConverged()) {
		return false
	}
	// same settle pass as AclfRunner: a converged NR loop can still violate the bus balance
	// after a PV->PQ limit conversion or a control step
	for (int i = 0; i < 3; i++) {
		def mm = aclfnet.maxMismatch(com.interpss.core.algo.AclfMethodType.NR)
		if (mm == null || mm.maxMis == null) break
		double worst = Math.max(Math.abs(mm.maxMis.real), Math.abs(mm.maxMis.imaginary))
		if (worst <= 1.0e-4) break
		algo.loadflow()
	}
	return aclfnet.isLfConverged()
}
def loadOf = { id -> aclfnet.getBus(id).getContributeLoad(LOAD_IDS[id]) }
def qOf    = { id -> (double) loadOf(id).loadCP.imaginary }
def setQ   = { id, q -> def l = loadOf(id); l.loadCP = new Complex(l.loadCP.real, q) }
def vOf    = { id -> (double) aclfnet.getBus(id).voltageMag }
def activeBuses = aclfnet.getBusList().findAll { it.isActive() }
def snapV  = { -> def m = [:]; activeBuses.each { b -> m[b.id] = [b.voltageMag, b.voltageAng] }; m }
def restoreV = { m -> m.each { id, va -> def b = aclfnet.getBus(id); b.voltageMag = va[0]; b.voltageAng = va[1] } }
def f5 = { d -> String.format('%9.5f', d) }
def f2 = { d -> String.format('%8.2f', d) }
def jac = { J -> '[' + f2(J[0][0]) + ' ' + f2(J[0][1]) + '; ' + f2(J[1][0]) + ' ' + f2(J[1][1]) + ']' }
def inv2 = { J ->
	double d = J[0][0] * J[1][1] - J[0][1] * J[1][0]
	[[J[1][1] / d, -J[0][1] / d], [-J[1][0] / d, J[0][0] / d]]
}
def inBand = { v -> v[0] >= BAND[0] && v[0] <= BAND[1] && v[1] >= BAND[0] && v[1] <= BAND[1] }
def errNorm = { v -> Math.max(Math.abs(v[0] - TARGET[0]), Math.abs(v[1] - TARGET[1])) }

// ------------------------------------------- reference dV/dQ matrix (senAlgo)
// M[f][t] = dV(bus_t) / dQinjection(bus_f) at the V ~ 1.0 pu linearization point
def M = BUSES.collect { f -> BUSES.collect { t -> senAlgo.calBusSensitivity(SenAnalysisType.QVOLTAGE, f, t) as double } }

def log = []
log << 'case      : data/ieee/Ieee14Bus_LargeLoadQ2/ieee14.ieee'
log << 'config    : ' + cfgFile.absolutePath
log << 'target    : V(Bus13)=' + TARGET[0] + '  V(Bus14)=' + TARGET[1] + '   band [0.90, 0.91]'
log << 'senAlgo   : dV/dQinjection at V~1.0 pu ' + jac(M) + '   [pu/pu, rows=Bus13,Bus14]'
log << ''

// ------------------------------------------------------ start from an anchor
if (!aclfnet.isLfConverged()) {
	BUSES.eachWithIndex { id, i -> setQ(id, ANCHOR_Q[i]) }
	aclfnet.initBusVoltage()
	def ok = solveLf()
	log << 'restart   : load Q -> base anchor (' + f2(ANCHOR_Q[0] * 100) + ',' + f2(ANCHOR_Q[1] * 100) +
			') MVAr, flat start, solved=' + ok
	if (!ok) {
		log << 'STOP      : the anchor did not solve -- nothing to adjust from'
		println log.join('\n')
		return 'ieee14_qv_adjust_0p90to0p91: FAILED (anchor did not solve)'
	}
	log << '            V = ' + f5(vOf('Bus13')) + ' / ' + f5(vOf('Bus14'))
	log << ''
}

// ------------------------------------------------------------ adjust loop
boolean converged = false
int iter = 0
while (iter < MAX_ITER) {
	def v0 = BUSES.collect { vOf(it) }
	def e0 = [v0[0] - TARGET[0], v0[1] - TARGET[1]]      // > 0 -> voltage too low -> add load Q
	if (errNorm(v0) <= V_TOL) {
		converged = true
		break
	}
	def far = errNorm(v0) > FAR
	double eps = far ? EPS_FAR : EPS_NEAR

	// ---- local dV/dQ matrix at this operating point, by finite differences ----
	def J = [[0d, 0d], [0d, 0d]]
	def probe = []
	BUSES.eachWithIndex { id, c ->
		def qSave = BUSES.collect { qOf(it) }
		def vSave = snapV()
		setQ(id, qSave[c] + eps)
		if (solveLf()) {
			def vp = BUSES.collect { vOf(it) }
			BUSES.eachWithIndex { bid, r -> J[r][c] = (vp[r] - v0[r]) / eps }
			probe << 'fd'
		} else {
			J[0][c] = -M[0][c]          // senAlgo is dV/dQinjection; a load is a negative injection
			J[1][c] = -M[1][c]
			probe << 'senAlgo'
		}
		// restore the pre-probe Q and solved state
		BUSES.eachWithIndex { bid, i -> setQ(bid, qSave[i]) }
		restoreV(vSave)
		solveLf()
	}

	// the probes restored the model -- re-read the point the Newton step starts from
	v0 = BUSES.collect { vOf(it) }
	e0 = [v0[0] - TARGET[0], v0[1] - TARGET[1]]

	// ---- Newton step on that matrix: dQload = inv(J) @ (Vtarget - V_measured) ----
	def Ji = inv2(J)
	def raw = [-(Ji[0][0] * e0[0] + Ji[0][1] * e0[1]),
	           -(Ji[1][0] * e0[0] + Ji[1][1] * e0[1])]
	def step = [raw[0] * ALPHA, raw[1] * ALPHA]
	// cap the predicted voltage move so a step cannot jump over the band
	def pv = [J[0][0] * step[0] + J[0][1] * step[1], J[1][0] * step[0] + J[1][1] * step[1]]
	double cap = far ? V_CAP_FAR : V_CAP_NEAR
	double pm = Math.max(Math.abs(pv[0]), Math.abs(pv[1]))
	if (pm > cap) {
		step = [step[0] * cap / pm, step[1] * cap / pm]
	}

	// ---- apply with a line search that only accepts an improvement ----
	def q0 = BUSES.collect { qOf(it) }
	def best = errNorm(v0)
	def saved = snapV()
	double scale = 1.0d
	boolean accepted = false
	def v1 = v0
	int tries = 0
	while (tries <= MAX_BACKTRACK) {
		BUSES.eachWithIndex { id, i -> setQ(id, q0[i] + step[i] * scale) }
		if (solveLf()) {
			v1 = BUSES.collect { vOf(it) }
			if (errNorm(v1) < best) {
				accepted = true
				break
			}
		}
		BUSES.eachWithIndex { id, i -> setQ(id, q0[i]) }
		restoreV(saved)
		solveLf()
		scale *= 0.5d
		tries++
	}
	if (!accepted) {
		log << String.format('iter %2d  : stalled -- no step size improved max|V-target| (J %s, step %s,%s MVAr)',
				iter + 1, jac(J), f2(step[0] * 100), f2(step[1] * 100))
		break
	}

	def pred = [(J[0][0] * step[0] + J[0][1] * step[1]) * scale,
	            (J[1][0] * step[0] + J[1][1] * step[1]) * scale]
	log << String.format('iter %2d  : Qload(13,14) %s,%s -> %s,%s MVAr | V(13,14) %s,%s | J %s (%s) | dQ %s,%s MVAr | dV pred %s,%s actual %s,%s',
			iter + 1,
			f2(q0[0] * 100), f2(q0[1] * 100),
			f2(qOf('Bus13') * 100), f2(qOf('Bus14') * 100),
			f5(v0[0]), f5(v0[1]),
			jac(J), probe.join('+'),
			f2(step[0] * scale * 100), f2(step[1] * scale * 100),
			f5(pred[0]), f5(pred[1]),
			f5(v1[0] - v0[0]), f5(v1[1] - v0[1]))
	iter++
}

// ---------------------------------------------------------------- report
def vf = BUSES.collect { vOf(it) }
log << ''
log << 'result    : solved=' + aclfnet.isLfConverged() + '  passes=' + iter + '  converged=' + converged
log << '            V(Bus13) = ' + vf[0] + '   V(Bus14) = ' + vf[1]
log << '            Qload(Bus13) = ' + (qOf('Bus13') * 100) + ' MVAr    Qload(Bus14) = ' + (qOf('Bus14') * 100) + ' MVAr'
log << '            in band [0.90, 0.91]: Bus13=' + (vf[0] >= BAND[0] && vf[0] <= BAND[1]) +
		'  Bus14=' + (vf[1] >= BAND[0] && vf[1] <= BAND[1])
log << '            max |V - target| = ' + errNorm(vf) + ' pu'
println log.join('\n')

'ieee14_qv_adjust_0p90to0p91: V13=' + vf[0] + ' V14=' + vf[1] +
		' Q13=' + (qOf('Bus13') * 100) + 'MVAr Q14=' + (qOf('Bus14') * 100) +
		'MVAr solved=' + aclfnet.isLfConverged() + ' inBand=' + inBand(vf)
