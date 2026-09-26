package org.interpss.agent.runner;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;

import org.interpss.agent.input.IeeeFileAdapter;
import org.interpss.agent.script.gvy.AclfNetDshGvyScriptProcessor;
import org.interpss.agent.support.AgentTestSupport;
import org.interpss.numeric.datatype.Unit.UnitType;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.interpss.core.aclf.AclfBranch;
import com.interpss.core.aclf.AclfNetwork;

/**
 * The Groovy script adapter, driven the way the bridge drives it: a {@code .gvy} file
 * evaluated against a live {@code AclfNetwork}, with a before/after digest.
 */
class GvyScriptRunnerTest {

    @TempDir
    Path tempDir;

    private AclfNetwork net;

    @BeforeEach
    void setUp() throws Exception {
        net = IeeeFileAdapter.createAclfNet(AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());
    }

    private Path script(String name, String code) throws Exception {
        Path file = tempDir.resolve(name);
        Files.writeString(file, code);
        return file;
    }

    @Test
    void runOnNet_setsContributeLoadCP_andReportsTheDigest() throws Exception {
        // The shipped workspace fixture, verbatim: Complex comes from GVY_IMPORTS.
        double loadBefore = 2.59;
        Path file = script("ieee14_adjBus14.gvy", """
                busId = "Bus14";
                loadId = "Bus14-L1";
                loadP = 0.18;
                loadQ = 0.07;

                bus = aclfnet.getBus(busId);
                load = bus.getContributeLoad(loadId);
                load.loadCP = new Complex(loadP, loadQ);
                """);

        GvyScriptRunner.Result result = GvyScriptRunner.runOnNet(net, file);

        assertThat(net.getBus("Bus14").getLoadP()).isEqualTo(0.18);
        assertThat(result.busCount).isEqualTo(14);
        // A Groovy assignment is also the script's last expression, so the assigned
        // Complex comes back as a rendered scalar — harmless, and never the model.
        assertThat(result.returnValue).isEqualTo("(0.18, 0.07)");
        assertThat(result.returnType).isNull();
        assertThat(result.loadMwBefore).isCloseTo(loadBefore * 100.0, org.assertj.core.data.Offset.offset(0.5));
        assertThat(result.loadMw - result.loadMwBefore).isCloseTo(3.1, org.assertj.core.data.Offset.offset(0.05));
    }

    @Test
    void runOnNet_disablesBranchAndSetsZ() throws Exception {
        Path file = script("ieee14_adjBranch1_2.gvy", """
                fromBusId = "Bus1";
                toBusId = "Bus2";
                circuitId = "1";
                r = 0.02;
                x = 0.06;

                branch = aclfnet.getBranch(fromBusId, toBusId, circuitId);
                branch.status = false;
                branch.z = new Complex(r, x);
                """);

        GvyScriptRunner.runOnNet(net, file);

        AclfBranch branch = net.getBranch("Bus1", "Bus2", "1");
        assertThat(branch.isActive()).isFalse();
        assertThat(branch.getZ().getReal()).isEqualTo(0.02);
        assertThat(branch.getZ().getImaginary()).isEqualTo(0.06);
    }

    @Test
    void runOnNet_reportsAScalarReturnValue() throws Exception {
        Path file = script("scalar.gvy", "0.18 + 0.07\n");

        GvyScriptRunner.Result result = GvyScriptRunner.runOnNet(net, file);

        assertThat(result.returnValue).isEqualTo("0.25");
        assertThat(result.returnType).isNull();
    }

    @Test
    void runOnNet_reportsTheTypeOfAModelObjectInsteadOfSerializingIt() throws Exception {
        Path file = script("model.gvy", "aclfnet.getBus('Bus14')\n");

        GvyScriptRunner.Result result = GvyScriptRunner.runOnNet(net, file);

        assertThat(result.returnValue).isNull();
        assertThat(result.returnType).isNotBlank();
    }

    @Test
    void runOnNet_wrapsAGroovyFailureWithItsScriptLine() throws Exception {
        Path file = script("broken.gvy", """
                bus = aclfnet.getBus('Bus14');
                bus.noSuchProperty = 1;
                """);

        assertThatThrownBy(() -> GvyScriptRunner.runOnNet(net, file))
                .isInstanceOf(GvyScriptRunner.ScriptError.class)
                .hasMessageContaining("noSuchProperty")
                .satisfies((e) -> assertThat(((GvyScriptRunner.ScriptError) e).line()).isGreaterThan(0));
    }

    @Test
    void runOnNet_rejectsAMissingScript() {
        assertThatThrownBy(() -> GvyScriptRunner.runOnNet(net, tempDir.resolve("absent.gvy")))
                .isInstanceOf(java.io.IOException.class)
                .hasMessageContaining("not found");
    }

    /** Keep the shipped IEEE 14 fixture honest: it must still run against our loader. */
    @Test
    void runOnNet_workspaceFixtureApplies() throws Exception {
        Path fixture = AgentTestSupport.projectRootPath("wspace/data/ieee/Ieee14Bus/scripts/ieee14_adjBus14.gvy");
        Assumptions.assumeTrue(Files.isRegularFile(fixture), "workspace fixture missing: " + fixture);

        GvyScriptRunner.runOnNet(net, fixture);

        assertThat(net.getBus("Bus14").getLoadP()).isEqualTo(0.18);
    }

    // --- the adapter's inline entry point: no file, same binding and digest ---------

    @Test
    void runSourceOnNet_evaluatesInlineCodeWithTheSameContract() throws Exception {
        double loadBefore = 2.59;
        String code = """
                bus = aclfnet.getBus("Bus14");
                load = bus.getContributeLoad("Bus14-L1");
                load.loadCP = new Complex(0.50, 0.30);
                """;

        GvyScriptRunner.Result result = GvyScriptRunner.runSourceOnNet(net, code, "inline Groovy (3 lines)");

        assertThat(net.getBus("Bus14").getContributeLoad("Bus14-L1").getLoadCP().getReal()).isEqualTo(0.50);
        assertThat(net.getBus("Bus14").getContributeLoad("Bus14-L1").getLoadCP().getImaginary()).isEqualTo(0.30);
        assertThat(result.script).isEqualTo("inline Groovy (3 lines)");
        assertThat(result.returnValue).isEqualTo("(0.5, 0.3)");
        assertThat(result.busCount).isEqualTo(14);
        assertThat(result.loadMwBefore).isCloseTo(loadBefore * 100.0, org.assertj.core.data.Offset.offset(0.5));
        // 0.149 -> 0.50 pu on Bus14 is +35.1 MW on the 100 MVA base.
        assertThat(result.loadMw - result.loadMwBefore).isCloseTo(35.1, org.assertj.core.data.Offset.offset(0.05));
    }

    @Test
    void runSourceOnNet_defaultsTheLabelWhenNoneIsGiven() throws Exception {
        GvyScriptRunner.Result result = GvyScriptRunner.runSourceOnNet(net, "1 + 1\n", null);

        assertThat(result.returnValue).isEqualTo("2");
        assertThat(result.script).isEqualTo("inline Groovy");
    }

    @Test
    void runSourceOnNet_wrapsAGroovyFailureWithItsScriptLine() {
        assertThatThrownBy(() -> GvyScriptRunner.runSourceOnNet(net, "aclfnet.noSuchProperty = 1\n", "inline Groovy (1 line)"))
                .isInstanceOf(GvyScriptRunner.ScriptError.class)
                .hasMessageContaining("noSuchProperty")
                .satisfies((e) -> assertThat(((GvyScriptRunner.ScriptError) e).line()).isEqualTo(1));
    }

    @Test
    void runSourceOnNet_rejectsEmptySource() {
        assertThatThrownBy(() -> GvyScriptRunner.runSourceOnNet(net, "   \n", "inline Groovy"))
                .isInstanceOf(GvyScriptRunner.ScriptError.class)
                .hasMessageContaining("empty");
    }

    // The generated Groovy class starts with GVY_IMPORTS, so a raw stack line would point
    // four lines below the text the caller wrote. `line` must be the caller's own line.
    @Test
    void runSourceOnNet_reportsTheLineInTheCallersScriptNotThePrependedImports() {
        String code = "a = 1\nb = 2\naclfnet.noSuchThing = 3\n";

        assertThatThrownBy(() -> GvyScriptRunner.runSourceOnNet(net, code, "inline Groovy (3 lines)"))
                .isInstanceOf(GvyScriptRunner.ScriptError.class)
                .hasMessageContaining("noSuchThing")
                .satisfies((e) -> assertThat(((GvyScriptRunner.ScriptError) e).line()).isEqualTo(3));
    }

    @Test
    void runOnNet_reportsTheLineInTheCallersFile() throws Exception {
        Path file = script("broken-on-line-3.gvy", "a = 1\nb = 2\naclfnet.noSuchThing = 3\n");

        assertThatThrownBy(() -> GvyScriptRunner.runOnNet(net, file))
                .isInstanceOf(GvyScriptRunner.ScriptError.class)
                .satisfies((e) -> assertThat(((GvyScriptRunner.ScriptError) e).line()).isEqualTo(3));
    }

    /** The offset the generated class shifts by is exactly the import block's line count. */
    @Test
    void gvyImportLines_isTheImportBlockHeight() {
        String imports = AclfNetDshGvyScriptProcessor.GVY_IMPORTS;

        assertThat(imports).endsWith("\n");
        assertThat(imports.lines().count()).isEqualTo(imports.chars().filter((c) -> c == '\n').count());
    }

    @Test
    void runSourceOnNet_matchesTheFileEntryPointForTheSameCode() throws Exception {
        String code = "aclfnet.getBus('Bus14').getContributeLoad('Bus14-L1').loadCP = new Complex(0.50, 0.30);\n";

        GvyScriptRunner.runOnNet(net, script("same.gvy", code));

        AclfNetwork fresh = IeeeFileAdapter.createAclfNet(
                AgentTestSupport.absoluteResourcePath(AgentTestSupport.IEEE14_CASE).toString());
        GvyScriptRunner.runSourceOnNet(fresh, code, "inline Groovy (1 line)");

        UnitType mva = UnitType.mVA;
        assertThat(fresh.totalLoad(mva).getReal()).isEqualTo(net.totalLoad(mva).getReal());
        assertThat(fresh.getNoActiveBranch()).isEqualTo(net.getNoActiveBranch());
    }
}
