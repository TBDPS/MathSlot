#![forbid(unsafe_code)]

mod app;
mod devshot;
mod modals;
mod render;
mod theme;

use eframe::egui;

fn main() -> eframe::Result {
    let icon = eframe::icon_data::from_png_bytes(
        include_bytes!("../assets/icons/mathslot-256.png")
    ).expect("Failed to load embedded icon");

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_app_id("mathslot")
            .with_icon(icon)
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
