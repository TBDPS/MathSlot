use mathslot_render::{
    BackendKind, Generation, LatexRustSvgBackend, MathRenderer, RenderData, RenderFormat, RenderId,
    RenderMode, RenderRequest, Theme,
};
use std::hint::black_box;
use std::time::{Duration, Instant};

const MAX_RENDER_P95_MS: f64 = 100.0;

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

fn main() {
    let rss_before = current_rss_kb();
    let backend = LatexRustSvgBackend::new();

    let cold_req = RenderRequest {
        id: RenderId(1),
        generation: Generation(1),
        mode: RenderMode::Preview,
        latex: r"\frac{1}{2}".to_owned(),
        theme: Theme::Light,
        scale: 1.0,
        format: RenderFormat::Svg,
        backend: BackendKind::LatexRust,
    };
    let t_cold0 = Instant::now();
    let cold_out = backend
        .render(&cold_req)
        .expect("cold LatexRustSvgBackend render must succeed");
    let cold_ms = t_cold0.elapsed().as_secs_f64() * 1000.0;
    let rss_after_font = current_rss_kb();
    assert!(matches!(cold_out.output, RenderData::Svg(ref s) if s.contains("<svg")));

    let formulas = [
        r"\frac{a}{b}",
        r"\int_{0}^{\infty} e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}",
        r"\begin{pmatrix} a & b & c \\ d & e & f \\ g & h & i \end{pmatrix}",
        r"\sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}",
    ];

    let mut samples = Vec::with_capacity(120);
    for i in 0..120 {
        let tex = formulas[i % formulas.len()];
        let req = RenderRequest {
            id: RenderId((i as u64) + 2),
            generation: Generation((i as u64) + 2),
            mode: RenderMode::Preview,
            latex: tex.to_owned(),
            theme: if i % 2 == 0 {
                Theme::Light
            } else {
                Theme::Dark
            },
            scale: 1.0,
            format: RenderFormat::Svg,
            backend: BackendKind::LatexRust,
        };
        let t0 = Instant::now();
        let out = backend
            .render(&req)
            .expect("warm LatexRustSvgBackend render must succeed");
        let dt = t0.elapsed();
        assert!(matches!(out.output, RenderData::Svg(ref s) if s.contains("<svg")));
        black_box(out);
        samples.push(dt);
    }

    samples.sort_unstable();
    let p50 = percentile_ms(&samples, 50);
    let p95 = percentile_ms(&samples, 95);
    let max = samples
        .last()
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let avg: f64 = samples
        .iter()
        .map(|d| d.as_secs_f64() * 1000.0)
        .sum::<f64>()
        / (samples.len().max(1) as f64);

    println!(
        "latex_rust_render: cold={cold_ms:.4}ms p50={p50:.4}ms p95={p95:.4}ms avg={avg:.4}ms max={max:.4}ms rss_before_kb={:?} rss_after_kb={:?}",
        rss_before, rss_after_font
    );

    assert!(
        cold_ms < MAX_RENDER_P95_MS,
        "cold render {cold_ms:.4}ms exceeded budget < {MAX_RENDER_P95_MS}ms"
    );
    assert!(
        p95 < MAX_RENDER_P95_MS,
        "warm render p95 {p95:.4}ms exceeded budget < {MAX_RENDER_P95_MS}ms"
    );
}
