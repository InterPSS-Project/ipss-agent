bus2Id = 'Bus2';
bus2Weight = 1.0;
bus14Id = 'Bus14';
bus14Weight = 0.9;
bus13Id = 'Bus13';
bus13Weight = 0.1;
branchId = 'Bus9->Bus14(1)';
senAlgo.injectBusList.clear()
senAlgo.addInjectBus(aclfnet.getBus(bus2Id), bus2Weight)
senAlgo.withdrawBusList.clear()
senAlgo.addWithdrawBus(aclfnet.getBus(bus14Id), bus14Weight)
senAlgo.addWithdrawBus(aclfnet.getBus(bus13Id), bus13Weight)
branch = aclfnet.getBranch(branchId)
f = senAlgo.genTransferDistFactor(branch)
return f;