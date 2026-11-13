use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Size2D {
    pub width: f32,
    pub height: f32,
}

impl Size2D {
    pub const fn new(width: f32, height: f32) -> Self {
        Self { width, height }
    }

    pub fn is_valid(self) -> bool {
        self.width.is_finite() && self.height.is_finite() && self.width > 0.0 && self.height > 0.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum FitPolicy {
    FitToWidth,
    FitToBox,
    ActualScale(f32),
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FitResult {
    pub display_size: Size2D,
    pub effective_scale: f32,
    pub display_percent: u32,
    pub left_aligned: bool,
    pub scrollable_x: bool,
    pub scrollable_y: bool,
}

pub fn true_scale_percent(scale: f32) -> u32 {
    if !scale.is_finite() || scale <= 0.0 {
        0
    } else {
        (scale * 100.0).round().max(0.0) as u32
    }
}

pub fn fit_to_box(content: Size2D, max_width: f32, max_height: f32, max_scale: f32) -> FitResult {
    let max_w = if max_width.is_finite() {
        max_width.max(1.0)
    } else {
        1.0
    };
    let max_h = if max_height.is_finite() {
        max_height.max(1.0)
    } else {
        1.0
    };

    if !content.is_valid() {
        return FitResult {
            display_size: Size2D::new(1.0, 1.0),
            effective_scale: 1.0,
            display_percent: 100,
            left_aligned: false,
            scrollable_x: false,
            scrollable_y: false,
        };
    }

    let requested = if max_scale.is_finite() {
        max_scale.max(0.05)
    } else {
        1.0
    };
    let scale = requested
        .min(max_w / content.width)
        .min(max_h / content.height)
        .max(0.0);

    let display_w = (content.width * scale).min(max_w);
    let display_h = (content.height * scale).min(max_h);

    FitResult {
        display_size: Size2D::new(display_w, display_h),
        effective_scale: scale,
        display_percent: true_scale_percent(scale),
        left_aligned: false,
        scrollable_x: false,
        scrollable_y: false,
    }
}

pub fn fit_to_width(
    content: Size2D,
    max_width: f32,
    actual_scale_override: Option<f32>,
) -> FitResult {
    let max_w = if max_width.is_finite() {
        max_width.max(1.0)
    } else {
        1.0
    };

    if !content.is_valid() {
        return FitResult {
            display_size: Size2D::new(1.0, 1.0),
            effective_scale: 1.0,
            display_percent: 100,
            left_aligned: false,
            scrollable_x: false,
            scrollable_y: false,
        };
    }

    if let Some(scale_override) = actual_scale_override {
        let scale = if scale_override.is_finite() {
            scale_override.max(0.05)
        } else {
            1.0
        };
        let display_w = content.width * scale;
        let display_h = content.height * scale;
        let overflow_x = display_w > max_w;
        FitResult {
            display_size: Size2D::new(display_w, display_h),
            effective_scale: scale,
            display_percent: true_scale_percent(scale),
            left_aligned: overflow_x,
            scrollable_x: overflow_x,
            scrollable_y: false,
        }
    } else {
        let scale = (max_w / content.width).min(1.0);
        let display_w = (content.width * scale).min(max_w);
        let display_h = content.height * scale;
        FitResult {
            display_size: Size2D::new(display_w, display_h),
            effective_scale: scale,
            display_percent: true_scale_percent(scale),
            left_aligned: false,
            scrollable_x: false,
            scrollable_y: false,
        }
    }
}

pub fn fit_with_policy(content: Size2D, viewport: Size2D, policy: FitPolicy) -> FitResult {
    let mut res = match policy {
        FitPolicy::FitToWidth => fit_to_width(content, viewport.width, None),
        FitPolicy::FitToBox => fit_to_box(content, viewport.width, viewport.height, 1.0),
        FitPolicy::ActualScale(scale) => fit_to_width(content, viewport.width, Some(scale)),
    };
    let max_h = if viewport.height.is_finite() {
        viewport.height.max(1.0)
    } else {
        1.0
    };
    res.scrollable_y = res.display_size.height > max_h;
    res
}
