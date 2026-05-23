/**
 * Render a remote image as unicode QUADRANT art (truecolor ANSI) for the TUI.
 *
 * Each character cell packs a 2×2 pixel block using the quadrant glyphs (▘▝▖▗▀▄▌▐
 * ▚▞▙▟▛▜█) plus a foreground + background colour. That's double the horizontal detail
 * of half-block art, so a smaller image stays sharp. Works in any 24-bit-color
 * terminal and embeds cleanly in an Ink <Text>. Uses jimp (pure JS) — no natives.
 */
import { Jimp } from "jimp";

const ESC = "\x1b";
const reset = `${ESC}[0m`;

// bit order: TL,TR,BL,BR  (1 = foreground)
const QUAD: Record<string, string> = {
  "0000": " ",
  "1000": "▘",
  "0100": "▝",
  "0010": "▖",
  "0001": "▗",
  "1100": "▀",
  "0011": "▄",
  "1010": "▌",
  "0101": "▐",
  "1001": "▚",
  "0110": "▞",
  "1110": "▛",
  "1101": "▜",
  "1011": "▙",
  "0111": "▟",
  "1111": "█",
};

/**
 * Fetch + render `url` to half-block art lines, `cols` wide. Returns one string per
 * text row (each row packs two image pixel-rows). On any failure returns a single
 * placeholder line so callers never throw.
 */
export async function renderThumbnailLines(url: string, cols = 16): Promise<string[]> {
  if (!url) return ["(no image)"];
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", referer: "https://www.zepto.com/" } });
    if (!res.ok) return [`(image ${res.status})`];
    const buf = Buffer.from(await res.arrayBuffer());
    const img = await Jimp.read(buf);

    // 2×2 pixels per character cell. Terminal cells are ~2× taller than wide, so to
    // keep the image's real aspect ratio we use HALF as many text rows as the naive
    // pixel ratio would suggest (this is what stops the vertical stretch).
    const CELL_ASPECT = 2; // cell height / cell width
    const srcW = img.bitmap.width;
    const srcH = img.bitmap.height;
    const cw = Math.max(2, cols);
    const rows = Math.max(1, Math.round((cw * srcH) / srcW / CELL_ASPECT));
    const pw = cw * 2;
    const ph = rows * 2;
    img.resize({ w: pw, h: ph });

    const data = img.bitmap.data; // RGBA
    // composite over white so transparent product cutouts read as a clean card
    const at = (x: number, y: number): [number, number, number] => {
      const i = (y * pw + x) * 4;
      const al = data[i + 3] / 255;
      return [
        Math.round(data[i] * al + 255 * (1 - al)),
        Math.round(data[i + 1] * al + 255 * (1 - al)),
        Math.round(data[i + 2] * al + 255 * (1 - al)),
      ];
    };
    const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const avg = (g: number[][]): [number, number, number] =>
      [0, 1, 2].map((k) => Math.round(g.reduce((s, c) => s + c[k], 0) / g.length)) as [number, number, number];

    const lines: string[] = [];
    for (let ry = 0; ry < rows; ry++) {
      let line = "";
      for (let cx = 0; cx < cw; cx++) {
        const x = cx * 2;
        const y = ry * 2;
        const q = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)]; // TL,TR,BL,BR
        const Ls = q.map(lum);
        const mn = Math.min(...Ls);
        const mx = Math.max(...Ls);
        let fg: [number, number, number];
        let bg: [number, number, number];
        let glyph: string;
        if (mx - mn < 12) {
          // smooth block → one solid colour (avoids speckle)
          fg = bg = avg(q);
          glyph = "█";
        } else {
          const thr = (mn + mx) / 2;
          const bits = Ls.map((l) => (l >= thr ? 1 : 0));
          const fgG = q.filter((_, i) => bits[i] === 1);
          const bgG = q.filter((_, i) => bits[i] === 0);
          fg = fgG.length ? avg(fgG) : avg(bgG);
          bg = bgG.length ? avg(bgG) : fg;
          glyph = QUAD[bits.join("")] ?? "█";
        }
        line += `${ESC}[38;2;${fg[0]};${fg[1]};${fg[2]}m${ESC}[48;2;${bg[0]};${bg[1]};${bg[2]}m${glyph}`;
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
