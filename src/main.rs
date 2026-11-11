mod app;
mod devshot;
mod modals;
mod render;
mod theme;

use eframe::egui;

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1240.0, 820.0])
            .with_min_inner_size([980.0, 640.0])
            .with_title("MathSlot · 超轻量流式简码公式编辑器"),
        renderer: eframe::Renderer::Glow,
        ..Default::default()
    };

    eframe::run_native(
        "MathSlot",
        options,
        Box::new(|cc| Ok(Box::new(app::MathSlotApp::new(cc)))),
    )
}
