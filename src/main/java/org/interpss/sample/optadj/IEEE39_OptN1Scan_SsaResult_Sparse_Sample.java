package org.interpss.sample.optadj;

import java.util.ArrayList;
import java.util.List;

import com.interpss.core.DclfAlgoObjectFactory;
import com.interpss.core.aclf.AclfBranch;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.dclf.ContingencyAnalysisAlgorithm;
import com.interpss.core.algo.dclf.DclfMethod;
import com.interpss.core.algo.dclf.solver.IDclfSolver.CacheType;
import com.interpss.core.contingency.ContingencyBranchOutageType;
import com.interpss.core.contingency.dclf.DclfBranchOutage;
import com.interpss.core.contingency.dclf.DclfOutageBranch;
import com.interpss.core.funcImpl.dclf.AclfNetSsaHelper;
import com.interpss.optadj.algo.lf.AclfNetContigencyOptimizer;
import com.interpss.optadj.result.OptAdjResultContainer;
import com.interpss.optadj.result.SsaResultContainer;

public class IEEE39_OptN1Scan_SsaResult_Sparse_Sample {

	public static void main(String args[]) throws Exception {
	    // Load network
	    AclfNetwork net = IEEE39_Sample_Data.createTestCaseNetwork();

		// define an caAlgo object and perform DCLF 
		ContingencyAnalysisAlgorithm dclfAlgo = DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm(net,
				CacheType.SenNotCached, true);
		dclfAlgo.calculateDclf(DclfMethod.INC_LOSS);

		// define a contingency list
		List<DclfBranchOutage> contList = new ArrayList<>();
		net.getBranchList().stream()
			// make sure the branch is not connected to a reference bus.
			.filter(branch -> !((AclfBranch)branch).isConnect2RefBus())
			.forEach(branch -> {
				// create a contingency object for the branch outage analysis
				DclfBranchOutage cont = DclfAlgoObjectFactory.createContingency("contBranch:" + branch.getId());
				// create an open CA outage branch object for the branch outage analysis
				DclfOutageBranch outage = DclfAlgoObjectFactory.createCaOutageBranch(
						dclfAlgo.getDclfAlgoBranch(branch.getId()),
						ContingencyBranchOutageType.OPEN);
				cont.setOutageEquip(outage);
				contList.add(cont);
			});
	
		double caN1LoadingThreshold = 90.0;
		SsaResultContainer ssaResult = new AclfNetSsaHelper(dclfAlgo).contingencyScan(contList, caN1LoadingThreshold);
		System.out.println("Total number of branches over limit before OptAdj: " + ssaResult.getCaOverLimitInfo().size());

		OptAdjResultContainer optAdjResult = new OptAdjResultContainer(ssaResult);
		
		double caN1OptAdjLoadingThreshold = 100.0;
		new AclfNetContigencyOptimizer(true).optimize(dclfAlgo, optAdjResult, caN1OptAdjLoadingThreshold);
		optAdjResult.getOptAdjResults().forEach((genName, result) -> {
			System.out.println("GenAdjustResult: " + genName + ", " + result.toString());
		});

		dclfAlgo.calculateDclf(DclfMethod.INC_LOSS);
	
		SsaResultContainer ssaResultAfter = new AclfNetSsaHelper(dclfAlgo).contingencyScan(contList, ssaResult.getCaOverLimitInfo());	
		System.out.println("Total number of branches over limit after OptAdj: " + ssaResultAfter.getCaOverLimitInfo().size());
		ssaResultAfter.printCaOverLimitInfo(ssaResult.getCaOverLimitInfo());		
	}
}
