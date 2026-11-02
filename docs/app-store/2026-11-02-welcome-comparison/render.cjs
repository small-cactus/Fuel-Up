// Format a genuine simulator capture for the existing iPhone screenshot slots.
// Preserve all screen content with uniform scaling; no prices or UI are edited.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

async function main() {
  const source = path.join(__dirname, 'raw/welcome-iphone.png');
  const dimensions = {
    'iphone-large': [1320, 2868],
    'iphone-medium': [1206, 2622],
    'iphone-compact': [1080, 2340],
  };
  const manifest = [];
  for (const [kind, [width, height]] of Object.entries(dimensions)) {
    const directory = path.join(__dirname, 'exports', kind);
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, '01-welcome.png');
    await sharp(source)
      .resize(width, height, { fit: 'contain', background: '#FFFFFF' })
      .flatten({ background: '#FFFFFF' }).removeAlpha().png().toFile(target);
    const metadata = await sharp(target).metadata();
    if (metadata.width !== width || metadata.height !== height || metadata.hasAlpha) {
      throw new Error(`Invalid screenshot: ${target}`);
    }
    manifest.push({ file: path.relative(__dirname, target), width, height,
      sha256: crypto.createHash('sha256').update(await fs.readFile(target)).digest('hex') });
    for (const filename of ['02-trends.png', '03-e85.png', '04-brands.png']) {
      const original = path.join(__dirname, '../2026-10-07-conversion/exports', kind, filename);
      const copied = path.join(directory, filename);
      await fs.copyFile(original, copied);
      manifest.push({ file: path.relative(__dirname, copied), width, height,
        unchanged: true, source: path.relative(__dirname, original),
        sha256: crypto.createHash('sha256').update(await fs.readFile(copied)).digest('hex') });
    }
  }
  await sharp(source).resize({ width: 400 }).png()
    .toFile(path.join(__dirname, 'preview.png'));
  await fs.writeFile(path.join(__dirname, 'asset-manifest.json'), JSON.stringify({
    source: 'raw/welcome-iphone.png',
    sourceCommit: 'c4f746f',
    capture: 'Current Release simulator build; native welcome screen',
    prices: 'Illustrative prices shipped in the native onboarding screen, not current pump quotes.',
    transformations: 'Uniform scaling with minimal white padding to existing store dimensions. No content edits.',
    scope: 'First screenshot only, English (US), iPhone. Later screenshots and iPad remain unchanged.',
    exports: manifest,
  }, null, 2) + '\n');
  console.log(`Prepared ${manifest.length} iPhone screenshots; validated all three new exports.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
