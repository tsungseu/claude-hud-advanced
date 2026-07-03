// Convert claude-hud's ANSI-colored stdout into safe HTML for the webview.
//
// claude-hud emits:
//   - SGR foreground colors: \x1b[3Xm (8 basic), \x1b[38;5;Nm (256-color),
//     \x1b[38;2;r;g;bm (truecolor), \x1b[2m dim, \x1b[0m reset
//     (see src/render/colors.ts).
//   - OSC 8 hyperlinks: \x1b]8;;<url>\x1b\\<text>\x1b]8;;\x1b\\
//     (src/utils/hyperlinks.ts, emitted/truncated in src/render/index.ts).
//
// We walk the string with a cursor, splitting into runs. Output is a single
// HTML string with <span style="color:..."> for colors and <a> for links.

// Basic SGR foreground table (codes 30-37). Bright variants use 90-97.
const BASIC_COLORS: Record<number, string> = {
  0: '#000000', 1: '#cc0000', 2: '#4e9a06', 3: '#c4a000',
  4: '#3465a4', 5: '#75507b', 6: '#06989a', 7: '#d3d7cf',
};
const BRIGHT_COLORS: Record<number, string> = {
  0: '#555753', 1: '#ef2929', 2: '#8ae234', 3: '#fce94f',
  4: '#729fcf', 5: '#ad7fa8', 6: '#34e2e2', 7: '#eeeeec',
};

interface Style {
  color: string | null;
  dim: boolean;
}

function newStyle(): Style {
  return { color: null, dim: false };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function openSpan(style: Style): string {
  const parts: string[] = [];
  if (style.color) parts.push(`color:${style.color}`);
  if (style.dim) parts.push('opacity:0.55');
  return parts.length ? `<span style="${parts.join(';')}">` : '';
}

/**
 * Convert an ANSI/OSC8-colored string into HTML for a webview.
 * The caller wraps the result in a <pre> with a monospace font.
 */
export function ansiToHtml(input: string): string {
  let out = '';
  let buf = '';
  const stack: string[] = [];
  const style = newStyle();

  const flushBuf = (): void => {
    if (buf) {
      const span = openSpan(style);
      if (span) {
        out += span + esc(buf) + '</span>';
      } else {
        out += esc(buf);
      }
      buf = '';
    }
  };

  // OSC 8 hyperlink state.
  let linkUrl: string | null = null;
  const openLinkSpan = (): void => {
    if (linkUrl) {
      const safe = esc(linkUrl).replace(/"/g, '&quot;');
      out += `<a href="${safe}" style="text-decoration:underline;color:inherit" title="${safe}">`;
      stack.push('</a>');
    }
  };

  let i = 0;
  while (i < input.length) {
    const ESC = '\x1b';

    // --- OSC 8 hyperlink: \x1b]8;;<url>\x1b\ or \x1b]8;;\x1b\ (close) ---
    if (input.startsWith(ESC + ']8;;', i)) {
      flushBuf();
      let j = i + 5; // skip ESC ] 8 ; ;
      const end = input.indexOf(ESC + '\\', j);
      if (end === -1) {
        // malformed; emit rest literally and stop
        buf = input.slice(i);
        flushBuf();
        break;
      }
      const url = input.slice(j, end);
      if (linkUrl) {
        // close current link first
        while (stack.length && stack[stack.length - 1] === '</a>') {
          out += stack.pop();
        }
        linkUrl = null;
      }
      if (url) {
        linkUrl = url;
        openLinkSpan();
      }
      i = end + 2; // skip ESC \
      continue;
    }

    // --- SGR sequence: \x1b[...m ---
    if (input[i] === ESC && input[i + 1] === '[') {
      let j = i + 2;
      while (j < input.length && input[j] !== 'm' && input[j] !== ESC) {
        j++;
      }
      if (j < input.length && input[j] === 'm') {
        flushBuf();
        applySGR(input.slice(i + 2, j), style, stack);
        i = j + 1;
        continue;
      }
      // Not a complete SGR; treat ESC literally.
    }

    buf += input[i];
    i++;
  }
  flushBuf();
  // Close any still-open link.
  while (stack.length) {
    out += stack.pop();
  }
  return out;
}

function applySGR(params: string, style: Style, _stack: string[]): void {
  if (params === '') {
    style.color = null;
    style.dim = false;
    return;
  }
  const codes = params.split(';').map((p) => Number.parseInt(p, 10));
  for (let k = 0; k < codes.length; k++) {
    const code = Number.isNaN(codes[k]) ? 0 : codes[k];
    if (code === 0) {
      style.color = null;
      style.dim = false;
    } else if (code === 2) {
      style.dim = true;
    } else if (code === 22) {
      style.dim = false;
    } else if (code >= 30 && code <= 37) {
      style.color = BASIC_COLORS[code - 30] ?? null;
    } else if (code >= 90 && code <= 97) {
      style.color = BRIGHT_COLORS[code - 90] ?? null;
    } else if (code === 38) {
      // extended color: 38;5;N (256) or 38;2;r;g;b (truecolor)
      const mode = codes[k + 1];
      if (mode === 5 && codes[k + 2] !== undefined) {
        style.color = color256(codes[k + 2]);
        k += 2;
      } else if (mode === 2 && codes[k + 4] !== undefined) {
        style.color = `rgb(${codes[k + 2]},${codes[k + 3]},${codes[k + 4]})`;
        k += 4;
      }
    } else if (code === 39) {
      style.color = null;
    }
    // Background / underline / etc. are ignored: the HUD uses only foreground.
  }
}

function color256(n: number): string {
  // Standard 0-15 = basic/bright, 16-231 = 6x6x6 cube, 232-255 = grayscale.
  if (n < 8) return BASIC_COLORS[n] ?? '#cccccc';
  if (n < 16) return BRIGHT_COLORS[n - 8] ?? '#cccccc';
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  n -= 16;
  const r = Math.floor(n / 36) % 6;
  const g = Math.floor(n / 6) % 6;
  const b = n % 6;
  const conv = (c: number): number => (c === 0 ? 0 : 55 + c * 40);
  return `rgb(${conv(r)},${conv(g)},${conv(b)})`;
}
