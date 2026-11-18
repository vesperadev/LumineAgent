//! 窗口位置/尺寸契约 +「上次那扇窗还在不在屏幕上」的纯函数校验。
//! 行为契约 1:1 对齐 Percho `packages/desktop/src/main/window-bounds.ts`（MIT）。
//! 本模块不依赖 tauri 运行时，纯函数可在无窗口环境下测试。

use serde::{Deserialize, Serialize};

// 没记过 bounds 时的默认尺寸 1100×750 与最小尺寸 640×480 由 tauri.conf.json 声明，两处需保持同步

/// 窗口与所选屏幕 workArea 的最小交集：两个方向都不小于它才算「这块屏上还看得见」
pub const BOUNDS_MIN_VISIBLE_W: f64 = 160.0;
pub const BOUNDS_MIN_VISIBLE_H: f64 = 80.0;
/// bounds 落盘防抖：拖动途中 resize/move 每帧都来，不能每帧写盘
pub const BOUNDS_SAVE_DEBOUNCE_MS: u64 = 400;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn overlap_size(a: &Rect, b: &Rect) -> (f64, f64, f64) {
    let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
    let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
    let width = width.max(0.0);
    let height = height.max(0.0);
    (width, height, width * height)
}

/// 校验并夹紧持久化的窗口 bounds（Percho spec §5.4 行为契约）：
/// 1. `raw` 为空 / 没有任何屏幕 / 交集太小 → `None`（调用方走默认尺寸与系统摆放）；
/// 2. 选**交集面积最大**的那块 workArea；
/// 3. 与它的交集宽 < `BOUNDS_MIN_VISIBLE_W` 或高 < `BOUNDS_MIN_VISIBLE_H` → `None`（拔屏/屏幕挪走）；
/// 4. 宽高超过该 workArea → 夹到 workArea 的宽高（大屏换小屏）；
/// 5. 平移，使窗口完整落在该 workArea 内（x/y 各自夹进合法区间）；
/// 6. 返回夹紧后的矩形（`x` 可以为负 —— 左侧副屏是合法的）。
pub fn sanitize(raw: Option<Rect>, work_areas: &[Rect]) -> Option<Rect> {
    let raw = raw?;
    if work_areas.is_empty() {
        return None;
    }
    let mut target: Option<&Rect> = None;
    let mut best_overlap = 0.0;
    for area in work_areas {
        let overlap = overlap_size(&raw, area);
        if overlap.2 > best_overlap {
            best_overlap = overlap.2;
            target = Some(area);
        }
    }
    let target = target?;
    let overlap = overlap_size(&raw, target);
    if overlap.0 < BOUNDS_MIN_VISIBLE_W || overlap.1 < BOUNDS_MIN_VISIBLE_H {
        return None;
    }
    let width = raw.width.min(target.width);
    let height = raw.height.min(target.height);
    let x = raw.x.clamp(target.x, target.x + target.width - width);
    let y = raw.y.clamp(target.y, target.y + target.height - height);
    Some(Rect { x, y, width, height })
}

/// tauri Monitor（物理像素）→ 逻辑坐标的 workArea 矩形，供 sanitize 使用
pub fn monitor_work_area(monitor: &tauri::Monitor) -> Rect {
    let work_area = monitor.work_area();
    let scale = monitor.scale_factor();
    let pos = work_area.position.to_logical::<f64>(scale);
    let size = work_area.size.to_logical::<f64>(scale);
    Rect {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect { x, y, width, height }
    }

    #[test]
    fn none_without_saved_bounds() {
        let screens = [rect(0.0, 0.0, 1920.0, 1040.0)];
        assert_eq!(sanitize(None, &screens), None);
    }

    #[test]
    fn none_without_screens() {
        let raw = rect(100.0, 100.0, 1100.0, 750.0);
        assert_eq!(sanitize(Some(raw), &[]), None);
    }

    #[test]
    fn window_fully_offscreen_is_reset() {
        let screens = [rect(0.0, 0.0, 1920.0, 1040.0)];
        // 完全在屏幕外
        let raw = rect(3000.0, 2000.0, 1100.0, 750.0);
        assert_eq!(sanitize(Some(raw), &screens), None);
        // 交集只有 100×750，宽向小于 160 → 重置
        let raw = rect(1820.0, 0.0, 1100.0, 750.0);
        assert_eq!(sanitize(Some(raw), &screens), None);
    }

    #[test]
    fn partially_visible_window_is_translated_back() {
        let screens = [rect(0.0, 0.0, 1920.0, 1040.0)];
        // 只露出 200×750（宽向可见 200 > 160，成立）
        let raw = rect(1720.0, 0.0, 1100.0, 750.0);
        let fit = sanitize(Some(raw), &screens).unwrap();
        assert_eq!(fit, rect(820.0, 0.0, 1100.0, 750.0));
    }

    #[test]
    fn oversized_window_is_clamped_to_work_area() {
        let screens = [rect(0.0, 0.0, 1366.0, 728.0)];
        let raw = rect(0.0, 0.0, 1920.0, 1080.0);
        let fit = sanitize(Some(raw), &screens).unwrap();
        assert_eq!(fit, rect(0.0, 0.0, 1366.0, 728.0));
    }

    #[test]
    fn picks_work_area_with_largest_overlap() {
        let left = rect(-1920.0, 0.0, 1920.0, 1040.0);
        let right = rect(0.0, 0.0, 1920.0, 1040.0);
        let screens = [left, right];
        // 窗口整体落在左侧副屏内：不允许被拉回主屏（x 为负合法）
        let raw = rect(-1800.0, 0.0, 1100.0, 750.0);
        assert_eq!(sanitize(Some(raw), &screens), Some(raw));
        // 窗口与主屏只有 1px 交集：交集面积远小于左侧，仍应选中左侧并原样保留
        let raw = rect(-1101.0, 0.0, 1100.0, 750.0);
        assert_eq!(sanitize(Some(raw), &screens), Some(raw));
    }

    #[test]
    fn normal_bounds_survive_in_screen() {
        let screens = [rect(0.0, 0.0, 1920.0, 1040.0)];
        let raw = rect(120.0, 80.0, 1100.0, 750.0);
        assert_eq!(sanitize(Some(raw), &screens), Some(raw));
    }
}