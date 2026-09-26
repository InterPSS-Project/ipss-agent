package org.interpss.agent.script.gvy;

import com.interpss.core.DclfAlgoObjectFactory;
import com.interpss.core.aclf.AclfNetwork;
import com.interpss.core.algo.dclf.SenAnalysisAlgorithm;

import groovy.lang.Binding;
import groovy.lang.GroovyShell;

/**
 * AclfNetwork Groovy script processor implementation.
 *
 * <p>Binds the network as {@code aclfnet} and a DC sensitivity analyser as
 * {@code senAlgo}; {@code Dsh} keeps it apart from the older
 * {@code org.interpss.script.gvy.AclfNetGvyScriptProcessor}.
 */
public class AclfNetDshGvyScriptProcessor extends BaseDshGvyScriptProcessor {
	private AclfNetwork aclfNet;
	
	/**
	 * Constructor
	 * 
	 * @param aclfNet
	 */
	public AclfNetDshGvyScriptProcessor(AclfNetwork aclfNet) {
		this.aclfNet = aclfNet;
		
	  	// 创建Binding对象，用于传递变量
        Binding binding = new Binding();
        binding.setVariable("aclfnet", aclfNet);

		// add the SenAnalysisAlgorithm to the binding
		SenAnalysisAlgorithm senAlgo = DclfAlgoObjectFactory.createSenAnalysisAlgorithm(aclfNet);
		binding.setVariable("senAlgo", senAlgo);
        
        this.shell = new GroovyShell(binding);
	}
	
	/**
	 * Get the AclfNetwork instance.
	 * 
	 * @return the AclfNetwork instance
	 */
	public AclfNetwork getAclfNet() {
		return this.aclfNet;
	}
}
