import jpype

from src.interpss import ipss


def network_info(net):
    """Match desktop NetworkUtil.getBasicNetworkInfo(AclfNetwork)."""
    lines = ["\n=====Aclf Network Information:=====\n"]
    lines.append(f"Number of Active Buses: {net.getNoActiveBus()}\n")
    lines.append(f"Number of Active Branches: {net.getNoActiveBranch()}\n")
    ut = ipss.UnitType.mVA
    lines.append(f"Total Generation (MW): {net.totalGeneration(ut).getReal():.2f}\n")
    lines.append(f"Total Load (MW): {net.totalLoad(ut).getReal():.2f}\n")

    ac = ipss.AclfAdjCtrlFunction
    n = int(ac.nOfZeroZBranch.apply(net))
    if n > 0:
        lines.append(f"Zero-Z Branches: {n}\n")
    n = int(ac.nOfPVBusLimit.apply(net))
    if n > 0:
        lines.append(f"PV bus limit controls: {n}\n")
    n = int(ac.nOfPVBusLimitWithSwShuntSVC.apply(net))
    if n > 0:
        lines.append(f"PV bus limit controls with Switched Shunt or SVC: {n}\n")
    n = int(ac.nOfPQBusLimit.apply(net))
    if n > 0:
        lines.append(f"PQ bus limit controls: {n}\n")
    n = int(ac.nOfRemoteQBus.apply(net))
    if n > 0:
        lines.append(f"Remote Q buses: {n}\n")
    n = int(ac.nOfSwitchedShuntBus.apply(net))
    if n > 0:
        lines.append(f"Switched shunts: {n}\n")
    n = int(ac.nOfSvcBus.apply(net))
    if n > 0:
        lines.append(f"SVCs: {n}\n")
    n = int(ac.nOfTapControl.apply(net))
    if n > 0:
        lines.append(f"Tap controls: {n}\n")
    n = int(ac.nOfPSXfrPControl.apply(net))
    if n > 0:
        lines.append(f"Phase shifting transformer P controls: {n}\n")

    n_hvdc = 0
    for b in net.getSpecialBranchList():
        if isinstance(b, ipss.HvdcLine2T):
            n_hvdc += 1
    if n_hvdc > 0:
        lines.append(f"HVDC lines: {n_hvdc}\n")

    lines.append("\n===== Loadflow Run Information:=====\n")
    lines.append(f"Loadflow converged: {net.isLfConverged()}\n")
    lines.append(f"Max mismatch: {net.maxMismatch(ipss.AclfMethodType.NR)}\n")
    return "".join(lines)
