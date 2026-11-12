use crate::model::Swatch;
use image::DynamicImage;

fn dist2(a: &[f32; 3], b: &[f32; 3]) -> f32 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

fn luma(p: &[f32; 3]) -> f32 {
    0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]
}

/// Dominant colours by k-means on a 64px copy, merged and sorted by share.
pub fn extract(img: &DynamicImage) -> Vec<Swatch> {
    let small = img.thumbnail(64, 64).to_rgba8();
    let px: Vec<[f32; 3]> = small
        .pixels()
        .filter(|p| p[3] >= 128)
        .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
        .collect();
    if px.is_empty() {
        return vec![];
    }
    let k = 8.min(px.len());
    let mut sorted = px.clone();
    sorted.sort_by(|a, b| luma(a).total_cmp(&luma(b)));
    let n = sorted.len();
    let mut centers: Vec<[f32; 3]> = (0..k).map(|i| sorted[((2 * i + 1) * n / (2 * k)).min(n - 1)]).collect();
    let mut counts = vec![0usize; k];
    for _ in 0..12 {
        let mut sums = vec![[0f32; 3]; k];
        counts = vec![0usize; k];
        for p in &px {
            let (mut best, mut bd) = (0, f32::MAX);
            for (j, c) in centers.iter().enumerate() {
                let d = dist2(p, c);
                if d < bd {
                    bd = d;
                    best = j;
                }
            }
            counts[best] += 1;
            for ch in 0..3 {
                sums[best][ch] += p[ch];
            }
        }
        for j in 0..k {
            if counts[j] > 0 {
                for ch in 0..3 {
                    centers[j][ch] = sums[j][ch] / counts[j] as f32;
                }
            }
        }
    }
    let mut groups: Vec<([f32; 3], usize)> = centers.into_iter().zip(counts).filter(|(_, c)| *c > 0).collect();
    groups.sort_by(|a, b| b.1.cmp(&a.1));
    let mut merged: Vec<([f32; 3], usize)> = vec![];
    for (c, cnt) in groups {
        if let Some(m) = merged.iter_mut().find(|(mc, _)| dist2(mc, &c) < 28.0 * 28.0) {
            m.1 += cnt;
        } else {
            merged.push((c, cnt));
        }
    }
    merged.sort_by(|a, b| b.1.cmp(&a.1));
    let total = px.len() as f32;
    merged
        .into_iter()
        .map(|(c, cnt)| Swatch {
            hex: format!("#{:02x}{:02x}{:02x}", c[0].round() as u8, c[1].round() as u8, c[2].round() as u8),
            ratio: cnt as f32 / total,
        })
        .filter(|s| s.ratio >= 0.02)
        .take(6)
        .collect()
}

pub fn hex_to_lab(hex: &str) -> Option<[f32; 3]> {
    let h = hex.trim_start_matches('#');
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(rgb_to_lab((v >> 16) as u8, (v >> 8) as u8, v as u8))
}

fn rgb_to_lab(r: u8, g: u8, b: u8) -> [f32; 3] {
    let lin = |c: u8| {
        let c = c as f32 / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let (r, g, b) = (lin(r), lin(g), lin(b));
    let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    let f = |t: f32| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// Close in plain Lab distance, or (for saturated colours) a similar hue
/// at a similar lightness, so "blue" finds both sky blue and royal blue.
fn similar(a: &[f32; 3], b: &[f32; 3]) -> bool {
    if dist2(a, b).sqrt() < 25.0 {
        return true;
    }
    let (ca, cb) = (a[1].hypot(a[2]), b[1].hypot(b[2]));
    if ca < 20.0 || cb < 20.0 {
        return false;
    }
    let mut dh = (a[2].atan2(a[1]) - b[2].atan2(b[1])).abs().to_degrees();
    if dh > 180.0 {
        dh = 360.0 - dh;
    }
    dh < 20.0 && (a[0] - b[0]).abs() < 35.0
}

/// True when a reasonably large part of the item is close to the target colour.
pub fn matches(palette: &[Swatch], target: &[f32; 3]) -> bool {
    palette.iter().any(|s| s.ratio >= 0.06 && hex_to_lab(&s.hex).map(|l| similar(&l, target)).unwrap_or(false))
}
