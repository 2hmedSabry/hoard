//! Tempo (BPM) estimate for audio: decode with ffmpeg, build an onset-strength
//! curve from frame energy, and pick the strongest beat period by autocorrelation.
use std::path::Path;
use std::process::{Command, Stdio};

const RATE: f32 = 11_025.0;
const HOP: usize = 128;

pub fn detect(file: &Path) -> Option<f32> {
    let ffmpeg = crate::import::tool("ffmpeg")?;
    let out = Command::new(ffmpeg)
        .args(["-v", "error", "-t", "120", "-i"])
        .arg(file)
        .args(["-ac", "1", "-ar", "11025", "-f", "f32le", "-"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let pcm: Vec<f32> = out.stdout.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    estimate(&pcm)
}

pub fn estimate(pcm: &[f32]) -> Option<f32> {
    if pcm.len() < (RATE as usize) * 6 {
        return None; // too short to tell
    }
    // Log energy per hop, then keep only rises (onsets).
    let energy: Vec<f32> = pcm.chunks(HOP).map(|c| (c.iter().map(|v| v * v).sum::<f32>() / c.len() as f32 + 1e-9).ln()).collect();
    let mut onset: Vec<f32> = energy.windows(2).map(|w| (w[1] - w[0]).max(0.0)).collect();
    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    onset.iter_mut().for_each(|v| *v -= mean);
    let fps = RATE / HOP as f32;
    let lag_of = |bpm: f32| (60.0 * fps / bpm).round() as usize;
    let (min_lag, max_lag) = (lag_of(200.0), lag_of(55.0));
    let ac = |lag: usize| -> f32 { onset.iter().zip(&onset[lag..]).map(|(a, b)| a * b).sum::<f32>() / (onset.len() - lag) as f32 };
    let mut best = (0usize, f32::MIN);
    for lag in min_lag..=max_lag.min(onset.len() / 2) {
        // Favour periods whose double also lines up (a steady beat, not a fluke).
        let score = ac(lag) + 0.5 * if lag * 2 < onset.len() { ac(lag * 2) } else { 0.0 };
        if score > best.1 {
            best = (lag, score);
        }
    }
    if best.1 <= 0.0 {
        return None;
    }
    let mut bpm = 60.0 * fps / best.0 as f32;
    // Report in the usual 70–180 range.
    while bpm < 70.0 {
        bpm *= 2.0;
    }
    while bpm > 180.0 {
        bpm /= 2.0;
    }
    Some((bpm * 10.0).round() / 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clicks(bpm: f32, secs: f32) -> Vec<f32> {
        let n = (RATE * secs) as usize;
        let period = (RATE * 60.0 / bpm) as usize;
        (0..n).map(|i| if i % period < 200 { ((i as f32) * 0.6).sin() * 0.8 } else { 0.0 }).collect()
    }

    #[test]
    fn click_tracks() {
        for bpm in [90.0, 120.0, 140.0] {
            let got = estimate(&clicks(bpm, 20.0)).unwrap();
            assert!((got - bpm).abs() < 2.5, "expected {bpm}, got {got}");
        }
        assert!(estimate(&vec![0.0; 1000]).is_none());
    }
}
