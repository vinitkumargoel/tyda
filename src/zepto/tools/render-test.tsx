/**
 * Render the TUI pieces to a string with ink-testing-library (no TTY needed) so we
 * can visually verify the product card, the input line + cursor, and the command
 * menu without launching the interactive app.
 *
 *   tsx src/zepto/tools/render-test.tsx
 */
import React from "react";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";
import { ProductCard, InputLine } from "../tui.js";
import { renderThumbnailLines } from "../image.js";
import { searchProducts } from "../commerce.js";
import { loadSession } from "../auth/session.js";

async function main() {
  const s = loadSession();
  const storeId = s?.storeId ?? "d5da3809-1327-4050-b59b-43342ea74482";

  // 1) a real product card
  const prods = await searchProducts("popcorn", storeId).catch(() => []);
  const p = prods.find((x) => !x.outOfStock) ?? prods[0];
  if (p) {
    const lines = await renderThumbnailLines(p.image, 16);
    console.log(`\n=== PRODUCT CARD (${p.name.slice(0, 40)}) — ${lines.length} image rows ===`);
    const { lastFrame } = render(<ProductCard idx={3} product={p} lines={lines} />);
    console.log(lastFrame());
  } else {
    console.log("(no products — session may be expired; card test skipped)");
  }

  // 2) input line with a cursor in the middle
  console.log("\n=== INPUT LINE (cursor mid-string) ===");
  const il = render(
    <Box>
      <Text color="cyan" bold>{"› "}</Text>
      <InputLine value="/search milk" cursor={3} />
    </Box>,
  );
  console.log(il.lastFrame());

  // 3) empty input shows placeholder + cursor
  console.log("\n=== INPUT LINE (empty → placeholder) ===");
  const il2 = render(
    <Box>
      <Text color="cyan" bold>{"› "}</Text>
      <InputLine value="" cursor={0} placeholder="type a message, or / for commands" />
    </Box>,
  );
  console.log(il2.lastFrame());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
