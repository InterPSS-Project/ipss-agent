package org.interpss.agent.util;

import org.interpss.numeric.datatype.Unit.UnitType;

import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.aclf.hvdc.HvdcLine2T;
import com.interpss.core.algo.AclfMethodType;
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
        sb.append("Max mismatch: ").append(net.maxMismatch(AclfMethodType.NR)).append('\n');
        return sb.toString();
    }

    private static void appendIfPositive(StringBuilder sb, String label, long count) {
        if (count > 0) {
            sb.append(label).append(": ").append(count).append('\n');
        }
    }
}
