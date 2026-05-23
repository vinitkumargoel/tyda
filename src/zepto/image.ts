/**
 * Render a remote image as unicode half-block art (truecolor ANSI) for the TUI.
 *
 * Each character cell "▀" carries two pixels: foreground = top pixel, background =
 * bottom pixel. This works in any 24-bit-color terminal and embeds cleanly in an
 * Ink <Text> node (no external image protocol needed). Uses jimp (pure JS) to
 * decode + resize, so there are no native dependencies.
 */
import { Jimp } from "jimp";

const ESC = "\x1b";
const reset = `${ESC}[0m`;

/**
 * Fetch + render `url` to half-block art lines, `cols` wide. Returns one string per
 * text row (each row packs two image pixel-rows). On any failure returns a single
 * placeholder line so callers never throw.
 */
export async function renderThumbnailLines(url: string, cols = 24): Promise<string[]> {
  if (!url) return ["(no image)"];
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.zepto.com/" } });
    if (!res.ok) return [`(image ${res.status})`];
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await Jimp.read(buf);

    // Keep aspect ratio; height in pixels must be even (two pixels per text row).
    const srcW = img.bitmap.width;
    const srcH = img.bitmap.height;
    const w = Math.max(2, cols);
    let h = Math.round((w * srcH) / srcW);
    if (h % 2 !== 0) h += 1;
    img.resize({ w, h });

    const data = img.bitmap.data; // RGBA
    const at = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const;
    };
    const onWhite = (r: number, g: number, b: number, a: number): [number, number, number] => {
      // composite over white so transparent product cutouts read as a white card, not black
      const al = a / 255;
      return [
        Math.round(r * al + 255 * (1 - al)),
        Math.round(g * al + 255 * (1 - al)),
        Math.round(b * al + 255 * (1 - al)),
      ];
    };

    const lines: string[] = [];
    for (let y = 0; y < h; y += 2) {
      let line = "";
      for (let x = 0; x < w; x++) {
        const [tr, tg, tb, ta] = at(x, y);
        const [br, bg, bb, ba] = at(x, y + 1);
        const [TR, TG, TB] = onWhite(tr, tg, tb, ta);
        const [BR, BG, BB] = onWhite(br, bg, bb, ba);
        line += `${ESC}[38;2;${TR};${TG};${TB}m${ESC}[48;2;${BR};${BG};${BB}m▀`;
      }
      lines.push(line + reset);
    }
    return lines;
  } catch (e) {
    return [`(image error: ${(e as Error).message})`];
  }
}

/** Same, joined into a single string (for plain-text contexts). */
export async function renderThumbnail(url: string, cols = 24): Promise<string> {
  return (await renderThumbnailLines(url, cols)).join("\n");
}
