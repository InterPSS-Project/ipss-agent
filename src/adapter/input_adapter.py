# Description: This module provides classes to create AclfNet objects from IEEE CDF and PSSE RAW files using ODM mappers.
import jpype

class IeeeFileAdapter:
    # IEEECDFVersion enum
    IEEECDFVersion = jpype.JClass("org.ieee.odm.adapter.ieeecdf.IeeeCDFAdapter$IEEECDFVersion")
    version = IEEECDFVersion

    # Create AclfNet from IEEE CDF file
    # arguments:
    #     file_path - path to the IEEE CDF file
    #     version   - version of the IEEE CDF format
    # returns AclfNet object
    @staticmethod
    def createAclfNet(file_path=None, version=IEEECDFVersion.Default):
         # ODM related classes
        ODMAclfParserMapper = jpype.JClass("org.interpss.odm.mapper.ODMAclfParserMapper")

        # IEEE CDF related classes
        IeeeCDFAdapter = jpype.JClass("org.ieee.odm.adapter.ieeecdf.IeeeCDFAdapter")

        # create the file adapter and parse the input file
        fileAdapter = IeeeCDFAdapter(version)
        fileAdapter.parseInputFile(file_path)

        # map the ODM model to InterPSS AclfNet model
        aclfNet = ODMAclfParserMapper().map2Model(fileAdapter.getModel()).getAclfNet()

        return aclfNet

# Deprecated class
class PsseRawFileAdapterOld:
    # PsseVersion enum
    PsseVersion = jpype.JClass("org.ieee.odm.adapter.psse.PSSEAdapter$PsseVersion")
    version = PsseVersion

    # Create AclfNet from PSSE RAW file
    # arguments:
    #     file_path - path to the PSSE RAW file
    #     version   - version of the PSSE RAW format
    # return AclfNet object
    @staticmethod
    def createAclfNet(file_path=None, version=None):
         # ODM related classes
        ODMAclfParserMapper = jpype.JClass("org.interpss.odm.mapper.ODMAclfParserMapper")

        # PSSE RAW related classes
        PSSERawAdapter = jpype.JClass("org.ieee.odm.adapter.psse.raw.PSSERawAdapter")

        # create the file adapter and parse the input file
        fileAdapter = PSSERawAdapter(version)
        fileAdapter.parseInputFile(file_path)

        # map the ODM model to InterPSS AclfNet model
        aclfNet = ODMAclfParserMapper().map2Model(fileAdapter.getModel()).getAclfNet()

        return aclfNet

class PsseRawFileAdapter:
    # Create AclfNet from PSSE RAW file
    # arguments:
    #     file_path - path to the PSSE RAW file
    # return AclfNet object
    @staticmethod
    def createAclfNet(file_path=None):
        IpssAdapter = jpype.JClass("org.interpss.plugin.pssl.plugin.IpssAdapter")

        # Automatically determine PSSE version by parsing the file
        psseVersion = IpssAdapter.parsePsseVersion(file_path)

        aclfNet = IpssAdapter.importAclfNet(file_path)              \
                        .setFormat(IpssAdapter.FileFormat.PSSE)     \
                        .setPsseVersion(psseVersion)                \
                        .load()                                     \
                        .getImportedObj()

        return aclfNet
