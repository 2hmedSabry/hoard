//! Camera details from a photo's EXIF data. GPS position is deliberately not read.
use crate::model::CameraInfo;
use exif::{In, Tag, Value};
use std::path::Path;

fn text(f: &exif::Exif, tag: Tag) -> Option<String> {
    let field = f.get_field(tag, In::PRIMARY)?;
    let s = match &field.value {
        Value::Ascii(v) => v.iter().map(|b| String::from_utf8_lossy(b).trim().to_string()).collect::<Vec<_>>().join(" "),
        _ => field.display_value().to_string(),
    };
    let s = s.trim().trim_matches('"').trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn rational(f: &exif::Exif, tag: Tag) -> Option<f64> {
    match &f.get_field(tag, In::PRIMARY)?.value {
        Value::Rational(v) => v.first().map(|r| r.to_f64()),
        Value::SRational(v) => v.first().map(|r| r.to_f64()),
        _ => None,
    }
}

/// "2024:05:01 14:22:10" → milliseconds since 1970 (taken as UTC).
fn parse_date(s: &str) -> Option<i64> {
    let (d, t) = s.trim().split_once(' ')?;
    let d: Vec<i64> = d.split(':').filter_map(|x| x.parse().ok()).collect();
    let t: Vec<i64> = t.split(':').filter_map(|x| x.parse().ok()).collect();
    if d.len() != 3 || t.len() < 2 || d[0] < 1900 {
        return None;
    }
    // Days from civil date (Howard Hinnant's algorithm).
    let (y, m, day) = (if d[1] <= 2 { d[0] - 1 } else { d[0] }, d[1], d[2]);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400) + t[0] * 3600 + t[1] * 60 + t.get(2).copied().unwrap_or(0)) * 1000)
}

pub fn read(path: &Path) -> Option<CameraInfo> {
    let file = std::fs::File::open(path).ok()?;
    let exif = exif::Reader::new().read_from_container(&mut std::io::BufReader::new(file)).ok()?;
    let make = text(&exif, Tag::Make);
    let model = text(&exif, Tag::Model);
    let camera = match (make, model) {
        (Some(mk), Some(md)) if md.to_lowercase().starts_with(&mk.to_lowercase()) => Some(md),
        (Some(mk), Some(md)) => Some(format!("{mk} {md}")),
        (a, b) => a.or(b),
    };
    let info = CameraInfo {
        camera,
        lens: text(&exif, Tag::LensModel),
        taken_at: text(&exif, Tag::DateTimeOriginal).or_else(|| text(&exif, Tag::DateTime)).and_then(|s| parse_date(&s)),
        exposure: text(&exif, Tag::ExposureTime),
        aperture: rational(&exif, Tag::FNumber).map(|v| format!("f/{v:.1}")),
        iso: text(&exif, Tag::PhotographicSensitivity),
        focal_length: rational(&exif, Tag::FocalLength).map(|v| format!("{v:.0} mm")),
    };
    let empty = info.camera.is_none() && info.lens.is_none() && info.taken_at.is_none() && info.exposure.is_none();
    (!empty).then_some(info)
}

#[cfg(test)]
mod tests {
    #[test]
    fn dates() {
        assert_eq!(super::parse_date("1970:01:02 00:00:00"), Some(86_400_000));
        assert_eq!(super::parse_date("2024:02:29 12:30:00"), Some(1_709_209_800_000));
        assert_eq!(super::parse_date("0000:00:00 00:00:00"), None);
    }
}
