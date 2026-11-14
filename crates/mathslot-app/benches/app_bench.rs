use mathslot_app::{App, AppEvent};
use mathslot_command::generated::GENERATED_COMMANDS;
use std::hint::black_box;
use std::time::{Duration, Instant};

const MAX_PARSE_P95_MS: f64 = 5.0;

fn current_rss_kb() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb_str = rest.trim().strip_suffix("kB")?.trim();
            return kb_str.parse::<u64>().ok();
        }
    }
    None
}

fn percentile_ms(sorted: &[Duration], p: usize) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() * p).div_ceil(100))
        .saturating_sub(1)
        .min(sorted.len() - 1);
    sorted[idx].as_secs_f64() * 1000.0
}

fn summarize(label: &str, samples: &[Duration]) -> (f64, f64, f64) {
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let total: f64 = sorted.iter().map(|d| d.as_secs_f64() * 1000.0).sum();
    let p50 = percentile_ms(&sorted, 50);
    let p95 = percentile_ms(&sorted, 95);
    let max = sorted
        .last()
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let avg = total / (sorted.len().max(1) as f64);
    println!(
        "{label}: count={} p50={p50:.4}ms p95={p95:.4}ms avg={avg:.4}ms max={max:.4}ms",
        sorted.len()
    );
    (p50, p95, max)
}

fn main() {
    let rss_start = current_rss_kb();
    let t_cold0 = Instant::now();
    let app = App::new();
    let cmd_count = GENERATED_COMMANDS.len();
    let cold_ms = t_cold0.elapsed().as_secs_f64() * 1000.0;
    black_box((&app, cmd_count));
    assert_eq!(cmd_count, 121, "single-source catalog count must be 121");

    // 1. Typical formula parse + dispatch_snapshot benchmark (D-154)
    let typical = [
        r"\frac{a}{b}",
        r"\int_{0}^{\infty} e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}",
        r"\begin{pmatrix} a & b & c \\ d & e & f \\ g & h & i \end{pmatrix}",
        r"\sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}",
    ];
    let mut parse_samples = Vec::with_capacity(200);
    for round in 0..50 {
        for formula in &typical {
            let mut engine = App::new();
            let t0 = Instant::now();
            let resp = engine.dispatch_snapshot(AppEvent::ImportLatex((*formula).to_string()));
            let dt = t0.elapsed();
            assert!(
                !resp
                    .snapshot
                    .last_import
                    .as_ref()
                    .map(|imp| imp.blocked)
                    .unwrap_or(true),
                "typical formula round {round} must import cleanly"
            );
            black_box(&resp);
            parse_samples.push(dt);
        }
    }
    let (_p50, parse_p95, _max) = summarize("typical_parse", &parse_samples);
    assert!(
        parse_p95 < MAX_PARSE_P95_MS,
        "typical parse p95 {parse_p95:.4}ms exceeded budget < {MAX_PARSE_P95_MS}ms"
    );

    // 2. Deep nesting 5000-level DoS guard parse (D-141)
    let deep_tex = format!("{}{}{}", "{".repeat(5000), "x", "}".repeat(5000));
    let mut deep_samples = Vec::with_capacity(20);
    for _ in 0..20 {
        let mut engine = App::new();
        let t0 = Instant::now();
        let resp = engine.dispatch_snapshot(AppEvent::PreviewImportLatex(deep_tex.clone()));
        let dt = t0.elapsed();
        assert!(
            resp.snapshot
                .last_import
                .as_ref()
                .map(|imp| imp.blocked)
                .unwrap_or(false),
            "5000-level deep nesting must block cleanly"
        );
        black_box(&resp);
        deep_samples.push(dt);
    }
    let (_dp50, deep_p95, _dmax) = summarize("deep_5000_parse", &deep_samples);
    assert!(
        deep_p95 < MAX_PARSE_P95_MS,
        "5000-level deep parse p95 {deep_p95:.4}ms exceeded budget < {MAX_PARSE_P95_MS}ms"
    );

    // 3. 1000 consecutive keystroke edits (D-155)
    let pattern = ['▸', 'f', 'a', ';', 'b', ';', '+'];
    let mut edit_app = App::new();
    let mut edit_samples = Vec::with_capacity(1000);
    for i in 0..1000 {
        let ch = pattern[i % pattern.len()];
        let t0 = Instant::now();
        let resp = edit_app.dispatch_snapshot(AppEvent::KeyInput(ch));
        let dt = t0.elapsed();
        black_box(&resp);
        edit_samples.push(dt);
    }
    let (_ep50, edit_p95, _emax) = summarize("stress_1000_edits", &edit_samples);
    let rss_end = current_rss_kb();
    println!(
        "startup_cold_ms={cold_ms:.4} rss_start_kb={:?} rss_end_kb={:?} edit_p95_ms={edit_p95:.4}",
        rss_start, rss_end
    );
}
