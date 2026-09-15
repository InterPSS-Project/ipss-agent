package org.interpss.agent.util;

import org.interpss.numeric.datatype.Unit.UnitType;

import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.aclf.hvdc.HvdcLine2T;
import com.interpss.core.algo.AclfMethodType;
import com.interpss.core.datatype.Mismatch;
import com.interpss.core.funcImpl.AclfAdjCtrlFunction;

/**
 * Network summary text for ACLF result files ({@code *_network_info.txt}).
 */
public final class IpssNetworkInfo {

    private IpssNetworkInfo() {
    }

    public static String format(AclfNetwork net) {
        StringBuilder sb = new StringBuilder();
        sb.append("\n=====Aclf Network Information:=====\n");
        sb.append("Number of Active Buses: ").append(net.getNoActiveBus()).append('\n');
        sb.append("Number of Active Branches: ").append(net.getNoActiveBranch()).append('\n');
        sb.append(String.format("Total Generation (MW): %.2f%n", net.totalGeneration(UnitType.mVA).getReal()));
        sb.append(String.format("Total Load (MW): %.2f%n", net.totalLoad(UnitType.mVA).getReal()));

        appendIfPositive(sb, "Zero-Z Branches", AclfAdjCtrlFunction.nOfZeroZBranch.apply(net));
        appendIfPositive(sb, "PV bus limit controls", AclfAdjCtrlFunction.nOfPVBusLimit.apply(net));
        appendIfPositive(sb, "PV bus limit controls with Switched Shunt or SVC",
                AclfAdjCtrlFunction.nOfPVBusLimitWithSwShuntSVC.apply(net));
        appendIfPositive(sb, "PQ bus limit controls", AclfAdjCtrlFunction.nOfPQBusLimit.apply(net));
        appendIfPositive(sb, "Remote Q buses", AclfAdjCtrlFunction.nOfRemoteQBus.apply(net));
        appendIfPositive(sb, "Switched shunts", AclfAdjCtrlFunction.nOfSwitchedShuntBus.apply(net));
        appendIfPositive(sb, "SVCs", AclfAdjCtrlFunction.nOfSvcBus.apply(net));
        appendIfPositive(sb, "Tap controls", AclfAdjCtrlFunction.nOfTapControl.apply(net));
        appendIfPositive(sb, "Phase shifting transformer P controls", AclfAdjCtrlFunction.nOfPSXfrPControl.apply(net));

        long nHvdc = net.getSpecialBranchList().stream().filter(HvdcLine2T.class::isInstance).count();
        appendIfPositive(sb, "HVDC lines", nHvdc);

        sb.append("\n===== Loadflow Run Information:=====\n");
        sb.append("Loadflow converged: ").append(net.isLfConverged()).append('\n');
        sb.append("Max Mismatch: ").append(maxMismatch(net)).append('\n');
        return sb.toString();
    }

    /**
     * The network's own residual, in pu on the 100 MVA base — the same value the NR loop
     * logs each iteration, so the summary matches the convergence criterion.
     *
     * <p>An earlier version special-cased GenPQ buses that had hit a PV Q limit with
     * switched-shunt or capacitor equipment, substituting {@code gen - calNetPQResults()}
     * for their mismatch. That expression is {@code load - capacitorQ} by construction —
     * it never measured the network at all — and so it reported 0.00002 where the bus was
     * genuinely 2.26 pu out of balance, hiding a 226 Mvar violation behind a clean-looking
     * report. {@code AclfRunner.runOnNet} now re-solves until that violation is gone, and
     * this reports whatever remains.
     */
    static Mismatch maxMismatch(AclfNetwork net) {
        net.calExternalPowerIntoNet();
        return net.maxMismatch(AclfMethodType.NR);
    }

    private static void appendIfPositive(StringBuilder sb, String label, long count) {
        if (count > 0) {
            sb.append(label).append(": ").append(count).append('\n');
        }
    }
}
