package org.interpss.agent.model;

import com.interpss.core.aclf.AclfNetwork;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * SimuModelRepository is a repository class that holds the AclfNetwork object
 */

public class SimuModelRepository {	
	private static final Logger log = LoggerFactory.getLogger(SimuModelRepository.class);

	// AclfNetwork base-case cache
	private AclfNetwork aclfNetBase;
	
	/**
	 * Constructor for DataModelRepository.
	 * 
	 */
	public SimuModelRepository() {
	}
	
	public AclfNetwork getAclfNetBase() {
		return aclfNetBase;
	}
	
	public void setAclfNetBase(AclfNetwork baseAclfNet) {
		if (baseAclfNet != null) {
			log.info("Setting ACLF network base case: {}", baseAclfNet.getName());
		} else {
			log.info("Clearing ACLF network base case");
		}
		this.aclfNetBase = baseAclfNet;
	}
}
