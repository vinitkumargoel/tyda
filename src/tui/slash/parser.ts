/**
 * Parse a slash-command input line.
 *
 * Rules:
 *  - Returns `null` if the line does not start with `/`.
 *  - `cmd` is everything between the leading `/` and the first whitespace,
 *    lowercased. An empty `/` is a valid command with `cmd === ""`.
 *  - The remainder is tokenized on whitespace, but double-quoted runs are
 *    preserved as a single token with the quotes stripped. Single quotes
 *    are not special. There is no escape handling inside quoted strings.
 */
export function parseSlash(
  line: string,
): { cmd: string; argv: string[] } | null {
  if (!line.startsWith("/")) return null;

  // Strip leading slash.
  const body = line.slice(1);

  // Split into command + rest on the first run of whitespace.
  const match = body.match(/^(\S*)\s*(.*)$/s);
  // The regex always matches against any string (\S* and .* both accept empty).
  const cmdRaw = match?.[1] ?? "";
  const rest = match?.[2] ?? "";

  const cmd = cmdRaw.toLowerCase();
  const argv = tokenize(rest);

  return { cmd, argv };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    // Skip whitespace between tokens.
    while (i < n && /\s/.test(input[i] ?? "")) i++;
    if (i >= n) break;

    if (input[i] === '"') {
      // Quoted token — read until the closing quote (or end-of-string).
      i++; // consume opening quote
      let buf = "";
      while (i < n && input[i] !== '"') {
        buf += input[i];
        i++;
      }
      if (i < n && input[i] === '"') i++; // consume closing quote
      tokens.push(buf);
    } else {
      // Bare token — read until whitespace.
      let buf = "";
      while (i < n && !/\s/.test(input[i] ?? "")) {
        buf += input[i];
        i++;
      }
      tokens.push(buf);
    }
  }

  return tokens;
}
