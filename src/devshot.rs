//! 开发辅助：`MATHSLOT_SHOT=/path/out.png` 时自动截取当前窗口并退出（用于 UI 回归比对）。
//! 可选 `MATHSLOT_SHOT_SRC` 预填简码流、`MATHSLOT_SHOT_MODAL=help|latex|custom|snippets` 打开弹窗。

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use eframe::egui;

pub struct DevShot {
    path: PathBuf,
    frame: u32,
    requested: bool,
    done: Arc<AtomicBool>,
    pub source: Option<String>,
    pub modal: Option<String>,
}

impl DevShot {
    pub fn from_env() -> Option<Self> {
        let path = std::env::var_os("MATHSLOT_SHOT")?;
        Some(Self {
            path: PathBuf::from(path),
            frame: 0,
            requested: false,
            done: Arc::new(AtomicBool::new(false)),
            source: std::env::var("MATHSLOT_SHOT_SRC").ok(),
            modal: std::env::var("MATHSLOT_SHOT_MODAL").ok(),
        })
    }

    pub fn tick(&mut self, ctx: &egui::Context) {
        self.frame += 1;
        ctx.request_repaint();
        if self.done.load(Ordering::SeqCst) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            std::process::exit(0);
        }
        if self.frame >= 10 && !self.requested {
            self.requested = true;
            let path = self.path.clone();
            let done = self.done.clone();
            let ctx_clone = ctx.clone();
            ctx.request_screenshot(move |img| {
                let [w, h] = img.size;
                let mut data = Vec::with_capacity(w * h * 4);
                for px in &img.pixels {
                    let [r, g, b, a] = px.to_array();
                    let a_f = a as f32 / 255.0;
                    let pr = ((r as f32 * a_f).round() as u8).min(a);
                    let pg = ((g as f32 * a_f).round() as u8).min(a);
                    let pb = ((b as f32 * a_f).round() as u8).min(a);
                    data.extend_from_slice(&[pr, pg, pb, a]);
                }
                if let Some(size) = tiny_skia::IntSize::from_wh(w as u32, h as u32)
                    && let Some(pixmap) = tiny_skia::Pixmap::from_vec(data, size)
                {
                    let _ = pixmap.save_png(&path);
                }
                done.store(true, Ordering::SeqCst);
                ctx_clone.request_repaint();
            });
        }
    }
}
