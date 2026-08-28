package org.interpss.agent.cli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class CliArgsTest {

    @Test
    void parseValidated_acceptsAclfWithThreeArgs() {
        CliArgs cli = CliArgs.parseValidated(new String[] {"aclf", "ieee", "data/ieee/Ieee14Bus/ieee14.ieee"});

        assertThat(cli.simutype()).isEqualTo("aclf");
        assertThat(cli.format()).isEqualTo("ieee");
        assertThat(cli.input()).isEqualTo("data/ieee/Ieee14Bus/ieee14.ieee");
        assertThat(cli.contFile()).isNull();
        assertThat(cli.monitorFile()).isNull();
    }

    @Test
    void parseValidated_acceptsCaWithFiveArgs() {
        CliArgs cli = CliArgs.parseValidated(new String[] {
                "ca",
                "psse",
                "data/psse/case.raw",
                "data/psse/cont.json",
                "data/psse/monitor.json"
        });

        assertThat(cli.simutype()).isEqualTo("ca");
        assertThat(cli.format()).isEqualTo("psse");
        assertThat(cli.contFile()).isEqualTo("data/psse/cont.json");
        assertThat(cli.monitorFile()).isEqualTo("data/psse/monitor.json");
    }

    @Test
    void parseValidated_rejectsTooFewArgs() {
        assertThatThrownBy(() -> CliArgs.parseValidated(new String[] {"aclf", "ieee"}))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Too few arguments");
    }

    @Test
    void parseValidated_rejectsInvalidSimutype() {
        assertThatThrownBy(() -> CliArgs.parseValidated(new String[] {"opf", "ieee", "case.ieee"}))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid simulation type");
    }

    @Test
    void parseValidated_rejectsInvalidFormat() {
        assertThatThrownBy(() -> CliArgs.parseValidated(new String[] {"aclf", "matpower", "case.ieee"}))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Invalid format");
    }
}
