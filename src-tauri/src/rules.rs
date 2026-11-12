//! Smart folder rules: saved conditions that pick items automatically.
use crate::model::{find_folder, folder_and_descendants, Item, LibraryMeta, Rule, SmartFolder};
use crate::palette;

const DAY_MS: f64 = 86_400_000.0;

fn text_op(v: &str, op: &str, want: &str) -> bool {
    let (v, w) = (v.to_lowercase(), want.trim().to_lowercase());
    match op {
        "contains" => v.contains(&w),
        "not_contains" => !v.contains(&w),
        "is" => v == w,
        "is_not" => v != w,
        "starts_with" => v.starts_with(&w),
        "ends_with" => v.ends_with(&w),
        "empty" => v.trim().is_empty(),
        "not_empty" => !v.trim().is_empty(),
        _ => false,
    }
}

fn num_op(v: f64, op: &str, want: &str) -> bool {
    let Ok(w) = want.trim().parse::<f64>() else { return false };
    match op {
        "gte" => v >= w,
        "lte" => v <= w,
        "eq" => (v - w).abs() < 1e-9,
        _ => false,
    }
}

pub fn eval(rule: &Rule, it: &Item, meta: &LibraryMeta, now: i64) -> bool {
    let v = rule.value.as_str();
    match rule.field.as_str() {
        "name" => text_op(&it.name, &rule.op, v),
        "note" => text_op(&it.note, &rule.op, v),
        "annotation" => match rule.op.as_str() {
            "empty" => it.annotations.is_empty(),
            "not_empty" => !it.annotations.is_empty(),
            op => it.annotations.iter().any(|a| text_op(&a.text, op, v)),
        },
        "url" => text_op(&it.url, &rule.op, v),
        "ext" => text_op(&it.ext, &rule.op, v.trim_start_matches('.')),
        "kind" => match rule.op.as_str() {
            "is" => it.kind == v,
            "is_not" => it.kind != v,
            _ => false,
        },
        "tags" => {
            let has = || it.tags.iter().any(|t| t.eq_ignore_ascii_case(v.trim()));
            match rule.op.as_str() {
                "has" => has(),
                "not_has" => !has(),
                "contains" => it.tags.iter().any(|t| t.to_lowercase().contains(&v.trim().to_lowercase())),
                "empty" => it.tags.is_empty(),
                "not_empty" => !it.tags.is_empty(),
                _ => false,
            }
        }
        "folder" => {
            let inside = || {
                find_folder(&meta.folders, v)
                    .map(folder_and_descendants)
                    .map(|ids| it.folders.iter().any(|f| ids.contains(f)))
                    .unwrap_or(false)
            };
            match rule.op.as_str() {
                "in" => inside(),
                "not_in" => !inside(),
                "empty" => it.folders.is_empty(),
                "not_empty" => !it.folders.is_empty(),
                _ => false,
            }
        }
        "rating" => num_op(it.rating as f64, &rule.op, v),
        "width" => num_op(it.width as f64, &rule.op, v),
        "height" => num_op(it.height as f64, &rule.op, v),
        "size" => num_op(it.size as f64 / 1_048_576.0, &rule.op, v),
        "duration" => it.duration.map(|d| num_op(d, &rule.op, v)).unwrap_or(false),
        "orientation" => {
            if it.width == 0 || it.height == 0 {
                return false;
            }
            let r = it.width as f64 / it.height as f64;
            match v {
                "landscape" => r > 1.05,
                "portrait" => r < 0.95,
                "square" => (0.95..=1.05).contains(&r),
                _ => false,
            }
        }
        "created" | "modified" => {
            let t = if rule.field == "created" { it.created_at } else { it.modified_at };
            let Ok(days) = v.trim().parse::<f64>() else { return false };
            let age = (now - t) as f64 / DAY_MS;
            match rule.op.as_str() {
                "within_days" => age <= days,
                "older_than_days" => age > days,
                _ => false,
            }
        }
        "color" => palette::hex_to_lab(v).map(|t| palette::matches(&it.palette, &t)).unwrap_or(false),
        _ => false,
    }
}

/// A smart folder with no rules matches everything.
pub fn matches(sf: &SmartFolder, it: &Item, meta: &LibraryMeta, now: i64) -> bool {
    if sf.rules.is_empty() {
        return true;
    }
    if sf.match_mode == "any" {
        sf.rules.iter().any(|r| eval(r, it, meta, now))
    } else {
        sf.rules.iter().all(|r| eval(r, it, meta, now))
    }
}
