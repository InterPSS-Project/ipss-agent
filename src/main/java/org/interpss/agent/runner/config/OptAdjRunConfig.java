package org.interpss.agent.runner.config;

public record OptAdjRunConfig(String optAdjType, Double scanLoadingThreshold, Double optAdjLoadingThreshold) {
    public static final String GEN_ADJ_BASE_CASE = "genAdjBaseCase";
    public static final String GEN_ADJ_CA_N1 = "genAdjCaN_1";
    
}
