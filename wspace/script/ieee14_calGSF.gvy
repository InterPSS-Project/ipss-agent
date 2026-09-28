busId = 'Bus8';
branchId = 'Bus5->Bus6(1)';
branch = aclfnet.getBranch(branchId);
gsf = senAlgo.calGenShiftFactor(busId, branch)
return gsf;