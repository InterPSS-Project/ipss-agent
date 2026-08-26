package org.interpss.agent.model;

import com.interpss.core.aclf.AclfNetwork;

/**
 * SimuModelRepository is a repository class that holds the AclfNetwork object
 */

public class SimuModelRepository {	
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
		this.aclfNetBase = baseAclfNet;
	}
}
