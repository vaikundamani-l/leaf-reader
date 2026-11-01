const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require('../vendor/jszip.min.js');

console.log('--- RUNNING EPUB INTEGRITY TESTS ---');

const sampleFiles = [
  'room.epub',
  'alice.epub',
  'siddhartha.epub',
  'pride.epub',
  'walden.epub',
  'garden.epub'
];

async function testAllEpubs() {
  for (const filename of sampleFiles) {
    const filePath = path.join(__dirname, '../library', filename);
    assert.ok(fs.existsSync(filePath), `EPUB file must exist: ${filename}`);
    const data = fs.readFileSync(filePath);
    assert.ok(data.length > 1000, `EPUB file ${filename} must not be empty`);

    const zip = await JSZip.loadAsync(data);
    const files = Object.keys(zip.files);
    assert.ok(files.length > 2, `${filename} must contain multiple zip entries`);

    // Verify EPUB container.xml
    const container = zip.file('META-INF/container.xml');
    assert.ok(container, `${filename} must contain META-INF/container.xml`);

    const containerXml = await container.async('string');
    assert.ok(containerXml.includes('full-path'), `${filename} container.xml must specify package full-path`);

    // Find package opf
    const match = containerXml.match(/full-path="([^"]+)"/);
    assert.ok(match && match[1], `${filename} must have rootfile full-path`);
    const opfPath = match[1];
    const opf = zip.file(opfPath);
    assert.ok(opf, `${filename} package.opf must exist at ${opfPath}`);

    const opfContent = await opf.async('string');
    assert.ok(opfContent.includes('<metadata'), `${filename} package.opf must contain metadata`);
    assert.ok(opfContent.includes('<spine'), `${filename} package.opf must contain spine`);

    console.log(`✓ PASS: ${filename} (Size: ${(data.length / 1024).toFixed(0)} KB, Valid container & spine)`);
  }
}

testAllEpubs()
  .then(() => console.log('ALL EPUB INTEGRITY TESTS PASSED!\n'))
  .catch(err => {
    console.error('EPUB test failed:', err);
    process.exit(1);
  });
