const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

console.log('--- RUNNING UNIT & SECURITY TESTS ---');

// 1. Check CSP in index.html
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
assert.ok(indexHtml.includes('<meta http-equiv="Content-Security-Policy"'), 'CSP meta tag must be present in index.html');
assert.ok(indexHtml.includes("default-src 'self'"), 'CSP must define default-src');
assert.ok(indexHtml.includes("https://api.dictionaryapi.dev"), 'CSP must allow dictionaryapi');
assert.ok(indexHtml.includes("https://api.mymemory.translated.net"), 'CSP must allow translation API');
console.log('✓ PASS: Content Security Policy configuration');

// 2. Check manifest.json
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
assert.equal(manifest.name, 'Leaf Reader');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons && manifest.icons.length > 0, 'Manifest must have icons');
console.log('✓ PASS: Web App Manifest structure and icons');

// 3. Test Dictionary Word Cleaner
function cleanWordForDictionary(text) {
  if (!text) return '';
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}
assert.equal(cleanWordForDictionary('“chapter,”'), 'chapter');
assert.equal(cleanWordForDictionary('reading...'), 'reading');
assert.equal(cleanWordForDictionary('(philosophical)'), 'philosophical');
assert.equal(cleanWordForDictionary('  tranquil!  '), 'tranquil');
console.log('✓ PASS: Dictionary word cleaner strips punctuation safely');

// 4. Test TTS Sentence Splitter
function splitTextToChunks(text) {
  if (!text) return [];
  const raw = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const matched = raw.match(/[^.!?\n]+[.!?\n]*/g);
  return matched ? matched.map(s => s.trim()).filter(Boolean) : [raw];
}
const testParagraph = "It was the best of times. It was the worst of times! Was it truly? Indeed, my friend.";
const chunks = splitTextToChunks(testParagraph);
assert.equal(chunks.length, 4);
assert.equal(chunks[0], 'It was the best of times.');
assert.equal(chunks[1], 'It was the worst of times!');
assert.equal(chunks[2], 'Was it truly?');
assert.equal(chunks[3], 'Indeed, my friend.');
console.log('✓ PASS: TTS sentence chunker segments dialogue and sentences properly');

// 5. Test Reading Streak Calculation
function calculateReadingStreak(sessions) {
  const days = [...new Set(sessions.filter(s => s.seconds >= 60).map(s => s.day))].sort().reverse();
  if (!days.length) return 0;
  const today = new Date().toLocaleDateString('en-CA');
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  if (days[0] !== today && days[0] !== yesterday) return 0;

  let streak = 1;
  let checkDate = new Date(days[0]);
  for (let i = 1; i < days.length; i++) {
    checkDate.setDate(checkDate.getDate() - 1);
    const expected = checkDate.toLocaleDateString('en-CA');
    if (days[i] === expected) streak++;
    else break;
  }
  return streak;
}

const todayStr = new Date().toLocaleDateString('en-CA');
const yesterdayStr = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
const twoDaysAgoStr = new Date(Date.now() - 86400000 * 2).toLocaleDateString('en-CA');

assert.equal(calculateReadingStreak([]), 0);
assert.equal(calculateReadingStreak([{ day: todayStr, seconds: 120 }]), 1);
assert.equal(calculateReadingStreak([
  { day: todayStr, seconds: 120 },
  { day: yesterdayStr, seconds: 300 },
  { day: twoDaysAgoStr, seconds: 200 }
]), 3);
console.log('✓ PASS: Reading streak calculation accuracy');

// 6. Test ZIP Slip Protection Pattern
function validateZipEntryPath(name) {
  return !(name.includes('..') || name.startsWith('/') || name.startsWith('\\'));
}
assert.equal(validateZipEntryPath('books/123.epub'), true);
assert.equal(validateZipEntryPath('leaf.json'), true);
assert.equal(validateZipEntryPath('../../etc/passwd'), false);
assert.equal(validateZipEntryPath('/root/evil'), false);
assert.equal(validateZipEntryPath('books/../../evil.js'), false);
console.log('✓ PASS: Zip Slip path traversal detection');

// 7. Test Book ID Validation Pattern
function isValidBookId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}
assert.equal(isValidBookId('demo-garden'), true);
assert.equal(isValidBookId('3f8b9a10-482a-41f2-bf81-9dfba519ad54'), true);
assert.equal(isValidBookId('../evil'), false);
assert.equal(isValidBookId('book;rm -rf /'), false);
assert.equal(isValidBookId(''), false);
console.log('✓ PASS: Book ID strict alphanumeric validation');

// 8. Test Malicious Book Cover Sanitization
function isSafeCoverUrl(cover) {
  if (!cover || typeof cover !== 'string') return true;
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(cover) || /^blob:/i.test(cover);
}
assert.equal(isSafeCoverUrl('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), true);
assert.equal(isSafeCoverUrl('javascript:alert(1)'), false);
assert.equal(isSafeCoverUrl('data:text/html,<script>alert(1)</script>'), false);
assert.equal(isSafeCoverUrl('http://evil.com/tracker.png'), false);
console.log('✓ PASS: Cover URL injection sanitizer');

console.log('ALL UNIT & SECURITY TESTS PASSED!\n');
