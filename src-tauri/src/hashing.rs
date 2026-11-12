//! Fingerprints for finding duplicates.
use image::{imageops::FilterType, DynamicImage};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const CHUNK: u64 = 1 << 20;

fn fnv1a(mut h: u64, bytes: &[u8]) -> u64 {
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Exact-copy fingerprint: file size plus a hash of the first and last megabyte.
/// Fast on huge videos, and stable across Rust versions.
pub fn file_hash(path: &Path) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let size = f.metadata()?.len();
    let mut buf = Vec::with_capacity(CHUNK as usize);
    (&mut f).take(CHUNK).read_to_end(&mut buf)?;
    let mut h = fnv1a(0xcbf29ce484222325, &buf);
    if size > CHUNK * 2 {
        f.seek(SeekFrom::End(-(CHUNK as i64)))?;
        buf.clear();
        f.take(CHUNK).read_to_end(&mut buf)?;
        h = fnv1a(h, &buf);
    }
    h = fnv1a(h, &size.to_le_bytes());
    Ok(format!("{size:x}-{h:016x}"))
}

/// Difference hash of the picture: 64 bits that barely change when an image is
/// resized, recompressed or slightly edited.
pub fn dhash(img: &DynamicImage) -> String {
    let g = img.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut v: u64 = 0;
    for y in 0..8 {
        for x in 0..8 {
            v = (v << 1) | (g.get_pixel(x, y)[0] > g.get_pixel(x + 1, y)[0]) as u64;
        }
    }
    format!("{v:016x}")
}
