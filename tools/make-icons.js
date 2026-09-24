'use strict';

// Renders the PNG app icons from icons/icon.svg. Needs Playwright:
//   npx playwright install chromium   (once)
//   node tools/make-icons.js
const { chromium } = require('playwright');
const fs = require('fs');
const svg = fs.readFileSync('icons/icon.svg', 'utf8');
// Maskable icons get cropped to a circle/squircle by Android: keep the logo inside the central 80%.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b0b0c"/>
<g transform="translate(146 146) scale(0.859)"><rect x="0" y="0" width="128" height="128" rx="22" fill="#f4f4f5"/><rect x="152" y="0" width="128" height="128" rx="22" fill="#ff6a1a"/><rect x="0" y="152" width="128" height="128" rx="22" fill="#ff6a1a"/><rect x="152" y="152" width="128" height="128" rx="22" fill="#f4f4f5"/></g></svg>`;
// Apple adds its own rounded corners, so the touch icon is a full square.
const square = svg.replace('rx="96"', 'rx="0"');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (markup, size, out) => {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await p.screenshot({ path: out, omitBackground: true });
  };
  await shot(svg, 192, 'icons/icon-192.png');
  await shot(svg, 512, 'icons/icon-512.png');
  await shot(maskable, 512, 'icons/maskable-512.png');
  await shot(square, 180, 'icons/apple-touch-icon.png');
  await b.close();
})();
