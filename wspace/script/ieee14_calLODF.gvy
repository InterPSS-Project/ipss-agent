outageBranchId = "Bus13->Bus14(1)";
monitorBranchId = "Bus9->Bus14(1)";
outageBranch = senAlgo.getDclfAlgoBranch(outageBranchId);
outageBranch = DclfAlgoObjectFactory.createCaOutageBranch(outageBranch, ContingencyBranchOutageType.OPEN);	
monitorBranch = aclfnet.getBranch(monitorBranchId);
lodf = senAlgo.lineOutageDFactor(outageBranch, monitorBranch);	
return lodf;