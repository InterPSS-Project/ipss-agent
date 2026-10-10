package org.interpss.sample.optadj;

import com.interpss.core.DclfAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.dclf.ContingencyAnalysisAlgorithm;
import com.interpss.core.algo.dclf.DclfMethod;
import com.interpss.core.algo.dclf.solver.IDclfSolver.CacheType;
import com.interpss.optadj.algo.lf.AclfNetLoadFlowOptimizer;
import com.interpss.core.funcImpl.dclf.AclfNetSsaHelper;
import com.interpss.optadj.result.OptAdjResultContainer;
import com.interpss.optadj.result.SsaResultContainer;

public class IEEE39_OptBasecase_SsaResult_Sparse_Sample {

	public static void main(String args[]) throws Exception {
	    // Load network
	    AclfNetwork net = IEEE39_Sample_Data.createTestCaseNetwork();

		// define an caAlgo object and perform DCLF 
		ContingencyAnalysisAlgorithm dclfAlgo = DclfAlgoObjectFactory.createContingencyAnalysisAlgorithm(net,
				CacheType.SenNotCached, true);
		dclfAlgo.calculateDclf(DclfMethod.INC_LOSS);

		SsaResultContainer ssaResult = new AclfNetSsaHelper(dclfAlgo).baseCaseScan(50.0);
		//ssaResult.printBaseOverLimitInfo();

		OptAdjResultContainer optAdjResult = new OptAdjResultContainer(ssaResult);
		
		// perform basecase loaing limit optimization	
		new AclfNetLoadFlowOptimizer(true).optimize(dclfAlgo, optAdjResult, 100.0);
		optAdjResult.getOptAdjResults().forEach((genName, result) -> {
			System.out.println("GenAdjustResult: " + genName + ", " + result.toString());
		});
		
		// perform DCLF recalculation after optimization
		dclfAlgo.calculateDclf(DclfMethod.INC_LOSS);	

		SsaResultContainer ssaResultAfter = new AclfNetSsaHelper(dclfAlgo).calBaseCaseLoading(ssaResult.getBaseOverLimitInfo());	
		ssaResultAfter.printBaseOverLimitInfo(ssaResult.getBaseOverLimitInfo());
	}
	
}
