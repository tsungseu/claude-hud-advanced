// Claude HUD for VS Code — extension icon.
//
// Visual concept: a Claude-family icon (coral #D97757 ground, white Claude
// starburst) overlaid with a small HUD readout in the lower portion — a
// progress bar + a gauge arc — to communicate "context/usage dashboard".
// The starburst path is a redrawn, simplified, ORIGINAL 16-arm sunburst
// inspired by Claude's mark (not the official path geometry), so the icon is
// an original work in the Claude visual idiom rather than a derived asset.
import sharp from 'sharp';

const CORAL = '#D97757';
const CORAL_DEEP = '#B85A3C';
const WHITE = '#FFFFFF';
const DARK = '#3A2418';

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <!-- Rounded-square background with a subtle top-light gradient for depth. -->
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E08868"/>
      <stop offset="1" stop-color="${CORAL}"/>
    </linearGradient>
  </defs>

  <!-- Background tile -->
  <rect x="6" y="6" width="116" height="116" rx="26" ry="26" fill="url(#bg)"/>

  <!-- Claude-style starburst (16 arms), centered upper area to leave room for HUD. -->
  <!-- Each arm is a rounded "petal"; drawn as a single path fill. Center ~ (64,50). -->
  <g transform="translate(64,50)" fill="${WHITE}">
    <g>
      <!-- 16 arms via repeated rotation. One arm = a thin tapered lozenge pointing up. -->
      ${Array.from({ length: 16 }, (_, i) => {
        const angle = (i * 360) / 16;
        return `<path transform="rotate(${angle})" d="M0,-30 C2.2,-20 2.2,-12 0,-6 C-2.2,-12 -2.2,-20 0,-30 Z"/>`;
      }).join('\n      ')}
    </g>
    <!-- Soft inner hub so arms read as radiating from a point. -->
    <circle r="6.5" fill="${WHITE}"/>
  </g>

  <!-- HUD readout panel: a translucent dark card across the lower third. -->
  <rect x="22" y="80" width="84" height="30" rx="8" ry="8" fill="${DARK}" opacity="0.92"/>

  <!-- Context bar: ~45% filled (green-ish on coral reads as teal/white here). -->
  <rect x="30" y="88"  width="68" height="5" rx="2.5" ry="2.5" fill="${WHITE}" opacity="0.22"/>
  <rect x="30" y="88"  width="30" height="5" rx="2.5" ry="2.5" fill="#5BC89B"/>

  <!-- Usage bar: ~56% filled -->
  <rect x="30" y="97"  width="68" height="5" rx="2.5" ry="2.5" fill="${WHITE}" opacity="0.22"/>
  <rect x="30" y="97"  width="38" height="5" rx="2.5" ry="2.5" fill="#7BB8FF"/>

  <!-- Tiny gauge tick on the right to suggest "instrument". -->
  <g transform="translate(108,92)" stroke="${WHITE}" stroke-width="2.4" fill="none" stroke-linecap="round">
    <path d="M-4,5 A5,5 0 1 1 4,5" opacity="0.85"/>
    <line x1="0" y1="0" x2="2.6" y2="-2.6"/>
  </g>
</svg>`;

const outPath = new URL('./icon.png', import.meta.url).pathname.replace(/^\//, '');
await sharp(Buffer.from(svg))
  .resize(128, 128)
  .png()
  .toFile(outPath);

console.log('wrote', outPath);
