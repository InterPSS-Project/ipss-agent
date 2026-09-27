package org.interpss.agent.script.gvy;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;

import org.apache.commons.math3.complex.Complex;
import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.numeric.util.NumericUtil;
import org.interpss.util.FileUtil;
import org.junit.jupiter.api.Test;

import com.interpss.core.aclf.AclfNetwork;

public class GvyScriptEvalTest {
	@Test 
	public void bus14testCase() throws Exception {
		AclfNetwork net = IeeeFileAdapter.createAclfNet(
				AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());
		
 		assertTrue(net.isContributeGenLoadModel());
 		
	  	AclfNetDshGvyScriptProcessor gvyProcessor = new AclfNetDshGvyScriptProcessor(net);
    	String groovyCode = "aclfnet.id = 'Modified';";
    	Object result = gvyProcessor.evaluate(groovyCode);
    	assertTrue(net.getId().equals("Modified"), "Net name should be 'Modified'");
    	
    	groovyCode = "aclfnet.getBus('Bus14').loadP = 0.18;";
		result = gvyProcessor.evaluate(groovyCode);
		assertEquals(0.18, net.getBus("Bus14").getLoadP(), 1.0E-4, "Bus load should be 0.18");
		
    	groovyCode = """
    			bus = aclfnet.getBus('Bus14');
    			load = bus.getContributeLoad('Bus14-L1');
    			load.loadCP = new Complex(0.18, 0.07); 
    		""";
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(NumericUtil.equals(net.getBus("Bus14").getContributeLoad("Bus14-L1").getLoadCP(), new Complex(0.18, 0.07), 1.0E-4), "Bus contribute load should be 0.18 + j0.07");

		groovyCode = """
    			branch = aclfnet.getBranch("Bus1", "Bus2", "1"); 
    			branch.z = new Complex(0.02, 0.06 );
    		""";
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(NumericUtil.equals(net.getBranch("Bus1", "Bus2", "1").getZ(), new Complex(0.02, 0.06), 1.0E-4), "Branch z should be 0.02+j0.06");
	}
	
	@Test 
	public void bus14ScriptFileTestCase() throws Exception {
		AclfNetwork net = IeeeFileAdapter.createAclfNet(
				AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());
		
 		assertTrue(net.isContributeGenLoadModel());
 		
	  	AclfNetDshGvyScriptProcessor gvyProcessor = new AclfNetDshGvyScriptProcessor(net);

	  	String scriptFile = AgentTestSupport.projectRootPath("wspace/script/ieee14_adjBus14.gvy").toString();
	  	String groovyCode = FileUtil.readFileAsString(scriptFile);
		
		Object result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(NumericUtil.equals(net.getBus("Bus14").getContributeLoad("Bus14-L1").getLoadCP(), new Complex(0.18, 0.07), 1.0E-4), "Bus contribute load should be 0.18 + j0.07");

		scriptFile = AgentTestSupport.projectRootPath("wspace/script/ieee14_adjBranch1_2.gvy").toString();
	  	groovyCode = FileUtil.readFileAsString(scriptFile);
		
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(NumericUtil.equals(net.getBranch("Bus1", "Bus2", "1").getZ(), new Complex(0.02, 0.06), 1.0E-4), "Branch z should be 0.02+j0.06");
		assertFalse(net.getBranch("Bus1", "Bus2", "1").isActive(), "Branch should be off");

		scriptFile = AgentTestSupport.projectRootPath("wspace/script/ieee14_calDv_dQ.gvy").toString();
		groovyCode = FileUtil.readFileAsString(scriptFile);
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(result instanceof Number, "dV/dQ script should return a Number");
		assertTrue(NumericUtil.equals(((Number) result).doubleValue(), 0.0608355, 1.0E-4),
					"Bus14→Bus13 dV/dQ should be non-zero");

		scriptFile = AgentTestSupport.projectRootPath("wspace/script/ieee14_calGSF.gvy").toString();
		groovyCode = FileUtil.readFileAsString(scriptFile);
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(result instanceof Number, "GSF script should return a Number");
		assertTrue(NumericUtil.equals(((Number) result).doubleValue(), -0.2181389, 1.0E-4),
					"Bus8 - Bus5->Bus6(1) GSF should match IEEE14 reference");

		scriptFile = AgentTestSupport.projectRootPath("wspace/script/ieee14_calWGenTFacotr.gvy").toString();
		groovyCode = FileUtil.readFileAsString(scriptFile);
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(result instanceof Number, "WGenT script should return a Number");
		assertTrue(NumericUtil.equals(((Number) result).doubleValue(), 0.57121, 1.0E-4),
					"Bus2 inject / Bus14(0.9)+Bus13(0.1) withdraw on Distrbution factor on Brancgh: Bus9->Bus14(1): should match IEEE14 reference");

		scriptFile = AgentTestSupport.projectRootPath("wspace/script/ieee14_calLODF.gvy").toString();
		groovyCode = FileUtil.readFileAsString(scriptFile);
		result = gvyProcessor.evaluate(groovyCode);
		System.out.println("Result: " + result);
		assertTrue(result instanceof Number, "LODF script should return a Number");
		assertTrue(NumericUtil.equals(((Number) result).doubleValue(), 1.0, 1.0E-4),
					"Bus13->Bus14(1) - Bus9->Bus14(1) LODF should match IEEE14 reference");
	}
}
