const ESCAPES = /(?:%[\dA-Fa-f]{2})+/g;

// a character a route path cannot hold decoded: a slash is a delimiter (`/a%2Fb` and `/a/b` are
// two routes), a percent sign could not be re-encoded, a query or fragment delimiter, a space or
// control character has no place in a path
const STAYS_ENCODED = /[/%?#\s\p{Cc}]/u;

function decodeRun(run: string): string {
  let decoded: string;

  try {
    decoded = decodeURIComponent(run);
  } catch {
    // a broken sequence is kept as it is
    return run.toUpperCase();
  }

  let result = '';

  for (const char of decoded) {
    result += STAYS_ENCODED.test(char) ? encodeURIComponent(char) : char;
  }

  return result;
}

/**
 * The one form a route path is stored and looked up in: percent escapes decoded and unicode
 * composed (NFC), as core normalizes it. A request arrives percent-encoded (`/%C3%BCber-uns`),
 * the stored path is decoded (`/über-uns`); both spellings must hit the same cache entry. An
 * escape of a character a path cannot hold decoded stays encoded, with uppercase hex.
 */
export function normalizeRoutePath(path: string): string {
  // eslint-disable-next-line unicorn/no-unsafe-string-replacement -- the replacer is a function, no `$` patterns apply
  return path.replaceAll(ESCAPES, decodeRun).normalize('NFC');
}
