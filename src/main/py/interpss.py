import jpype
import jpype.imports
from jpype.types import *

class ipss:
    #
    # Commons Classes
    #
    Complex = jpype.JClass("org.apache.commons.math3.complex.Complex")
    JavaFile = jpype.JClass("java.io.File")
    JavaHashSet = jpype.JClass("java.util.HashSet")

    #
    # InterPSS Core Classes
    #
    CoreObjectFactory = jpype.JClass("com.interpss.core.CoreObjectFactory")

    UnitType = jpype.JClass("org.interpss.numeric.datatype.Unit$UnitType")

    AclfMethodType = jpype.JClass("com.interpss.core.algo.AclfMethodType")
    AclfAdjCtrlFunction = jpype.JClass("com.interpss.core.funcImpl.AclfAdjCtrlFunction")
    HvdcLine2T = jpype.JClass("com.interpss.core.aclf.hvdc.HvdcLine2T")
      
    AclfGenCode = jpype.JClass("com.interpss.core.aclf.AclfGenCode")
    AclfLoadCode = jpype.JClass("com.interpss.core.aclf.AclfLoadCode")
    AclfBranchCode = jpype.JClass("com.interpss.core.aclf.AclfBranchCode")
   
    LoadflowAlgoObjectFactory = jpype.JClass("com.interpss.core.LoadflowAlgoObjectFactory")

    DclfAlgoObjectFactory = jpype.JClass("com.interpss.core.DclfAlgoObjectFactory")
    DclfMethod = jpype.JClass("com.interpss.core.algo.dclf.DclfMethod")
    DclfContingencyHelper = jpype.JClass("org.interpss.plugin.contingency.util.DclfContingencyHelper")
    ContingencyFileUtil = jpype.JClass("org.interpss.plugin.contingency.util.ContingencyFileUtil")
    MonitoredBranchRecord = jpype.JClass("org.interpss.plugin.contingency.definition.MonitoredBranchRecord")
    BranchContingencyRecord = jpype.JClass("org.interpss.plugin.contingency.definition.BranchContingencyRecord")

    DclfContingencyConfig = jpype.JClass("org.interpss.plugin.contingency.DclfContingencyConfig")
    ParallelDclfContingencyAnalyzer = jpype.JClass("org.interpss.plugin.contingency.ParallelDclfContingencyAnalyzer")
    DclfContingencyDFrameAdapter = jpype.JClass("org.interpss.plugin.result.dframe.ca.DclfContingencyDFrameAdapter")
  
    #
    # InterPSS Plugin Classes
    #
    AclfRunConfigRec = jpype.JClass("org.interpss.plugin.aclf.config.AclfRunConfigRec")

    AclfOutFunc = jpype.JClass("org.interpss.display.AclfOutFunc")
    
    AclfOut_PSSE = jpype.JClass("org.interpss.display.impl.AclfOut_PSSE")
    PSSEOutFormat = jpype.JClass("org.interpss.display.impl.AclfOut_PSSE$Format")

    AclfResultExchangeAdapter = jpype.JClass("org.interpss.plugin.exchange.AclfResultExchangeAdapter")
    ContingencyResultAdapter = jpype.JClass("org.interpss.plugin.exchange.ContingencyResultAdapter")
    ContingencyResultExContainer = jpype.JClass("org.interpss.plugin.exchange.ContingencyResultExContainer")

    AclfNetDFrameAdapter = jpype.JClass("org.interpss.plugin.result.dframe.AclfNetDFrameAdapter")

    DFrameCsv = jpype.JClass("org.dflib.csv.Csv")
    
    #
    # InterPSS Utility Classes
    #
    PerformanceTimer = jpype.JClass("org.interpss.numeric.util.PerformanceTimer")
    
    #
    # InterPSS Py lib classes
    #
    from adapter.input_adapter import PsseRawFileAdapterOld
    from adapter.input_adapter import PsseRawFileAdapter
    from adapter.input_adapter import IeeeFileAdapter
