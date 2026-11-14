use mathslot_latex::convert_latex_with_report;

#[test]
fn d138_unsupported_environment_report_is_lossy_warning_not_blocked() {
    let input = r"\begin{align} a &= b \\ c &= d \end{align}";
    let (_ast, report) = convert_latex_with_report(input);

    assert!(
        !report.lossless,
        "Unsupported environment must be marked non-lossless"
    );
    assert!(
        !report.has_errors(),
        "Closed unsupported environment must not block import"
    );
    assert!(
        report.has_warnings(),
        "Unsupported environment must emit Warning diagnostic"
    );
    assert_eq!(
        report.raw_nodes, 1,
        "Unsupported environment must count as RawLatex node"
    );
    assert_eq!(report.roundtrip_latex, input);
}

#[test]
fn d139_malformed_latex_cases_are_blocked_in_import_report() {
    let blocked_cases = [
        "1 + 2}",
        r"a \\ b",
        r"\frac{1}{",
        r"\sqrt{x",
        r"\unknownfoo{unclosed",
    ];

    for case in blocked_cases {
        let (_ast, report) = convert_latex_with_report(case);
        assert!(
            report.has_errors(),
            "Malformed input '{case}' must have error diagnostics and block import, report: {report:?}"
        );
        assert!(
            !report.lossless,
            "Blocked input '{case}' must not be marked lossless"
        );
    }
}

#[test]
fn d141_deep_5000_braces_blocked_cleanly_in_import_report() {
    let deep = format!("{}x{}", "{".repeat(5000), "}".repeat(5000));
    let (_ast, report) = convert_latex_with_report(&deep);
    assert!(
        report.has_errors(),
        "5000-level nested braces must emit Error and block import"
    );
}

#[test]
fn d142_outer_math_delimiters_stripped_cleanly_with_info_diagnostic() {
    for (wrapped, expected_inner) in [
        (r"$$\frac{a}{b}$$", r"\frac{a}{b}"),
        (r"  \[\frac{a}{b}\]  ", r"\frac{a}{b}"),
        (r"$\frac{a}{b}$", r"\frac{a}{b}"),
        (r"\(\frac{a}{b}\)", r"\frac{a}{b}"),
    ] {
        let (_ast, report) = convert_latex_with_report(wrapped);
        assert!(
            !report.has_errors(),
            "Wrapped '{wrapped}' must not fail with syntax error: {:?}",
            report.diagnostics
        );
        assert!(
            report.lossless,
            "Wrapped '{wrapped}' should parse losslessly after stripping outer delimiters: {report:?}"
        );
        assert_eq!(
            report.raw_nodes, 0,
            "Wrapped '{wrapped}' must not leave raw_nodes"
        );
        assert_eq!(report.roundtrip_latex, expected_inner);
        assert!(
            !report.diagnostics.is_empty(),
            "Wrapped '{wrapped}' should emit non-blocking Info diagnostic about stripped delimiters"
        );
    }

    // Unpaired outer delimiter must block import
    for broken in [r"\[\frac{a}{b}", r"$$\frac{a}{b}", r"$\frac{a}{b}"] {
        let (_ast, report) = convert_latex_with_report(broken);
        assert!(
            report.has_errors(),
            "Unpaired outer delimiter '{broken}' must emit Error and block import: {report:?}"
        );
    }
}
