use fontdue::{Font, FontSettings};
use image::{ImageBuffer, Rgba};
use std::{
    env,
    error::Error,
    fs,
    path::{Path, PathBuf},
};

const WIDTH: u32 = 1280;
const HEIGHT: u32 = 720;
const CLASSES: [(&str, [u8; 3], &str); 8] = [
    ("D", [0x3d, 0xba, 0xea], "500"),
    ("C", [0xf6, 0xbf, 0x31], "600"),
    ("B", [0xff, 0x65, 0x33], "700"),
    ("A", [0xfc, 0x35, 0x5a], "800"),
    ("S1", [0xbd, 0x5e, 0xe4], "900"),
    ("S2", [0x15, 0x67, 0xd6], "998"),
    ("R", [0x14, 0xb8, 0xa6], "999"),
    ("X", [0x11, 0x18, 0x27], "999"),
];

fn find_font(explicit: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = explicit {
        return path.is_file().then(|| path.to_owned());
    }
    let roots = ["/usr/share/fonts", "/usr/local/share/fonts"];
    let mut fallback = None;
    for root in roots {
        let Ok(entries) = walk(Path::new(root)) else {
            continue;
        };
        for path in entries {
            let lower = path.file_name()?.to_string_lossy().to_ascii_lowercase();
            if lower.ends_with(".ttf") || lower.ends_with(".otf") {
                if lower.contains("bold") || lower.contains("black") {
                    return Some(path);
                }
                if fallback.is_none() {
                    fallback = Some(path);
                }
            }
        }
    }
    fallback
}
fn walk(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut result = Vec::new();
    let mut pending = vec![root.to_owned()];
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
            } else {
                result.push(path);
            }
        }
    }
    Ok(result)
}

fn text_width(font: &Font, text: &str, size: f32) -> f32 {
    text.chars()
        .map(|c| font.metrics(c, size).advance_width)
        .sum()
}

fn draw_text(
    image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>,
    font: &Font,
    text: &str,
    size: f32,
    color: [u8; 4],
    center_x: f32,
    center_y: f32,
) -> Result<(), Box<dyn Error>> {
    let width = text_width(font, text, size);
    let mut x = center_x - width / 2.0;
    for c in text.chars() {
        let (metrics, bitmap) = font.rasterize(c, size);
        let top = center_y - metrics.height as f32 / 2.0;
        let left = x + metrics.xmin as f32;
        for (index, pixel) in bitmap.iter().enumerate() {
            let px = left + (index % metrics.width) as f32;
            let py = top + (index / metrics.width) as f32;
            if *pixel == 0 || px < 0.0 || py < 0.0 || px >= WIDTH as f32 || py >= HEIGHT as f32 {
                continue;
            }
            let base = [color[0], color[1], color[2]];
            let alpha = *pixel as u32;
            let existing = image.get_pixel(px as u32, py as u32).0;
            let blend = |a: u8, b: u8| ((a as u32 * (255 - alpha) + b as u32 * alpha) / 255) as u8;
            image.put_pixel(
                px as u32,
                py as u32,
                Rgba([
                    blend(existing[0], base[0]),
                    blend(existing[1], base[1]),
                    blend(existing[2], base[2]),
                    255,
                ]),
            );
        }
        x += metrics.advance_width;
    }
    Ok(())
}

fn create_icon(
    font: &Font,
    output: &Path,
    label: &str,
    color: [u8; 3],
    pi: &str,
) -> Result<(), Box<dyn Error>> {
    let mut image =
        ImageBuffer::from_pixel(WIDTH, HEIGHT, Rgba([color[0], color[1], color[2], 255]));
    let class_width = (WIDTH as f32 * 0.43) as u32;
    let inset_x = (HEIGHT as f32 * 0.05) as u32;
    let inset_y = (HEIGHT as f32 * 0.12) as u32;
    for y in inset_y..HEIGHT - inset_y {
        for x in class_width + inset_x..WIDTH - inset_x {
            image.put_pixel(x, y, Rgba([255, 255, 255, 255]));
        }
    }
    let mut label_size = HEIGHT as f32 * 0.95;
    while label_size > 80.0 && text_width(font, label, label_size) > class_width as f32 * 0.85 {
        label_size -= 10.0;
    }
    let mut pi_size = HEIGHT as f32 * 0.9;
    while pi_size > 80.0 && text_width(font, pi, pi_size) > (WIDTH - class_width) as f32 * 0.75 {
        pi_size -= 10.0;
    }
    draw_text(
        &mut image,
        font,
        label,
        label_size,
        [255, 255, 255, 255],
        class_width as f32 / 2.0,
        HEIGHT as f32 / 2.0,
    )?;
    draw_text(
        &mut image,
        font,
        pi,
        pi_size,
        [0, 0, 0, 255],
        class_width as f32 + (WIDTH - class_width) as f32 / 2.0,
        HEIGHT as f32 / 2.0,
    )?;
    image.save(output)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = env::args().skip(1);
    let output = PathBuf::from(args.next().unwrap_or_else(|| "media/classes".into()));
    if args.next().is_some() {
        return Err("Usage: generate-class-icons [output-directory]".into());
    }
    let font_path = env::var_os("CLASS_ICON_FONT").map(PathBuf::from);
    let path =
        find_font(font_path.as_deref()).ok_or("No .ttf/.otf font found; set CLASS_ICON_FONT")?;
    let bytes = fs::read(&path)?;
    let font = Font::from_bytes(bytes, FontSettings::default())
        .map_err(|e| format!("Could not load {}: {e}", path.display()))?;
    fs::create_dir_all(&output)?;
    for (label, color, pi) in CLASSES {
        let file = output.join(format!("{}.png", label.to_lowercase()));
        create_icon(&font, &file, label, color, pi)?;
        println!("Wrote {}", file.display());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn class_table_matches_previous_generator() {
        assert_eq!(CLASSES.len(), 8);
        assert_eq!(CLASSES[0], ("D", [0x3d, 0xba, 0xea], "500"));
        assert_eq!(CLASSES[7], ("X", [0x11, 0x18, 0x27], "999"));
    }
    #[test]
    fn project_slugs_use_lowercase_class_names() {
        assert_eq!("S1".to_lowercase(), "s1");
    }
}
