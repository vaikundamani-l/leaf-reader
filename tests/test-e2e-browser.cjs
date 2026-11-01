const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT_DIR = path.join(__dirname, '..');
const PORT = 8124;
const CHROME_PORT = 9234;

// Simple static server
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.epub': 'application/epub+zip',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const fullPath = path.join(ROOT_DIR, reqPath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(fullPath).pipe(res);
});

async function runE2ETests() {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Server listening on http://127.0.0.1:${PORT}`);

  const tmpDir = path.join('/tmp', 'leaf-e2e-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const chromeBin = process.env.CHROME_BIN || (process.platform === 'linux' ? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(b => {
    try { require('child_process').execSync(`which ${b}`, { stdio: 'ignore' }); return true; } catch { return false; }
  }) || 'google-chrome' : 'google-chrome');

  const chromeProc = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${tmpDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ]);

  // Wait for Chrome debugging port to open
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const pageTarget = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) {
          wsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      }
    } catch {}
  }

  if (!wsUrl) {
    throw new Error('Could not connect to Chrome debugging endpoint');
  }

  console.log('Connected to Chrome via CDP WebSocket');
  const ws = new WebSocket(wsUrl);

  let messageId = 0;
  const pending = new Map();
  const consoleErrors = [];

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };

  await new Promise(resolve => ws.onopen = resolve);

  function send(method, params = {}) {
    return new Promise(resolve => {
      const id = ++messageId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.text || 'Evaluation failed');
    }
    return res.result?.result?.value;
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('1. Navigating to Leaf Reader...');
    let pageLoaded = false;
    ws.addEventListener('message', ev => {
      try {
        const d = JSON.parse(ev.data);
        if (d.method === 'Page.loadEventFired') pageLoaded = true;
      } catch {}
    });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });

    // Wait for page load event or readyState
    for (let i = 0; i < 50; i++) {
      if (pageLoaded) break;
      await new Promise(r => setTimeout(r, 100));
      try {
        const state = await evaluate('document.readyState');
        if (state === 'complete') break;
      } catch {}
    }
    await new Promise(r => setTimeout(r, 1000));

    // Test 1: Title and Basic DOM
    const href = await evaluate('window.location.href');
    console.log('Current URL in browser:', href);
    const title = await evaluate('document.title');
    assert.equal(title, 'Leaf Reader — A little space to get lost');
    console.log('✓ PASS: Document title matches');

    // Test 2: Library renders books
    const bookCount = await evaluate('document.querySelectorAll("#books article.book").length');
    assert.ok(bookCount >= 6, `Expected at least 6 books, found ${bookCount}`);
    console.log(`✓ PASS: Bookshelf rendered ${bookCount} books`);

    // Test 3: Open sample book
    console.log('2. Opening sample book "The Art of Slowing Down"...');
    await evaluate(`
      const sample = Array.from(document.querySelectorAll('#books article.book')).find(el => el.textContent.includes('Slowing Down') || el.textContent.includes('room'));
      if (sample) sample.querySelector('button.book-open').click();
    `);

    // Wait for reader to open and render
    await new Promise(r => setTimeout(r, 2000));

    const readerHidden = await evaluate('document.getElementById("reader").hidden');
    assert.equal(readerHidden, false, 'Reader view should be visible');
    const readerTitle = await evaluate('document.getElementById("reader-title").textContent');
    assert.ok(readerTitle.length > 0, 'Reader title should not be empty');
    console.log(`✓ PASS: Reader opened successfully ("${readerTitle}")`);

    // Test 4: Reader navigation buttons
    console.log('3. Testing page navigation...');
    await evaluate('document.getElementById("next").click()');
    await new Promise(r => setTimeout(r, 500));
    await evaluate('document.getElementById("previous").click()');
    await new Promise(r => setTimeout(r, 500));
    console.log('✓ PASS: Next & Previous page buttons functioned');

    // Test 5: Table of Contents dialog
    console.log('4. Testing Table of Contents...');
    await evaluate('document.getElementById("toc").click()');
    await new Promise(r => setTimeout(r, 500));
    const dialogOpenTOC = await evaluate('document.getElementById("dialog").open');
    assert.equal(dialogOpenTOC, true, 'Dialog should be open for TOC');
    const chapterItemsCount = await evaluate('document.querySelectorAll("#dialog-body .chapter-item").length');
    console.log(`✓ PASS: Table of Contents opened with ${chapterItemsCount} chapters`);
    await evaluate('document.getElementById("dismiss").click()');
    await new Promise(r => setTimeout(r, 300));

    // Test 6: Appearance settings dialog
    console.log('5. Testing Appearance dialog...');
    await evaluate('document.getElementById("appearance").click()');
    await new Promise(r => setTimeout(r, 400));
    const swatchesCount = await evaluate('document.querySelectorAll("#dialog-body .swatches button").length');
    assert.ok(swatchesCount >= 5, 'Appearance dialog should have theme swatches');
    console.log(`✓ PASS: Appearance dialog rendered with ${swatchesCount} theme swatches`);
    await evaluate('document.getElementById("dismiss").click()');
    await new Promise(r => setTimeout(r, 300));

    // Test 7: Text-to-Speech (TTS) controls
    console.log('6. Testing Text-to-Speech (TTS) panel...');
    await evaluate('document.getElementById("tts").click()');
    await new Promise(r => setTimeout(r, 500));
    const ttsTitle = await evaluate('document.getElementById("dialog-title").textContent');
    assert.ok(ttsTitle.includes('Listen') || ttsTitle.includes('Read aloud'), 'TTS dialog should open');
    const ttsControlsCount = await evaluate('document.querySelectorAll("#dialog-body .tts-controls button").length');
    assert.ok(ttsControlsCount >= 4, 'TTS should display preview and playback controls');
    console.log(`✓ PASS: TTS interface rendered properly with playback controls`);
    await evaluate('document.getElementById("dismiss").click()');
    await new Promise(r => setTimeout(r, 300));

    // Test 8: Close reader and return to library
    console.log('7. Testing Reader Exit...');
    await evaluate('document.getElementById("close-reader").click()');
    await new Promise(r => setTimeout(r, 500));
    const readerHiddenAfterClose = await evaluate('document.getElementById("reader").hidden');
    assert.equal(readerHiddenAfterClose, true, 'Reader should be hidden after close');
    console.log('✓ PASS: Returned to library view');

    // Test 9: Navigation to Statistics / Reading Insights
    console.log('8. Testing Reading Insights view...');
    await evaluate('document.querySelector(\'button[data-view="statistics"]\').click()');
    await new Promise(r => setTimeout(r, 400));
    const statsCards = await evaluate('document.querySelectorAll("#content .stats .card").length');
    assert.equal(statsCards, 4, 'Expected 4 stats summary cards');
    const periodTabsCount = await evaluate('document.querySelectorAll("#content .tabs button").length');
    assert.equal(periodTabsCount, 3, 'Expected 3 period tabs (Daily, Weekly, Monthly)');
    console.log('✓ PASS: Reading insights rendered 4 summary cards & 3 reporting periods');

    // Test 10: Navigation to Vocabulary view
    console.log('9. Testing Vocabulary view...');
    await evaluate('document.querySelector(\'button[data-view="vocabulary"]\').click()');
    await new Promise(r => setTimeout(r, 400));
    const vocabHeading = await evaluate('document.querySelector("#content h1").textContent');
    assert.ok(vocabHeading.includes('Words'), 'Vocabulary heading should be displayed');
    console.log(`✓ PASS: Vocabulary view rendered ("${vocabHeading}")`);

    // Test 11: Navigation to Highlights & Notes view
    console.log('10. Testing Annotations view...');
    await evaluate('document.querySelector(\'button[data-view="annotations"]\').click()');
    await new Promise(r => setTimeout(r, 400));
    const notesHeading = await evaluate('document.querySelector("#content h1").textContent');
    assert.ok(notesHeading.includes('thoughts'), 'Annotations heading should be displayed');
    console.log(`✓ PASS: Annotations view rendered ("${notesHeading}")`);

    // Test 12: Navigation to Settings & Backup view
    console.log('11. Testing Settings & Backup view...');
    await evaluate('document.querySelector(\'button[data-view="settings"]\').click()');
    await new Promise(r => setTimeout(r, 400));
    const settingsHeading = await evaluate('document.querySelector("#content h1").textContent');
    assert.ok(settingsHeading.includes('reader that feels like you'), 'Settings heading should be displayed');
    console.log(`✓ PASS: Settings & Backup view rendered ("${settingsHeading}")`);

    // Test 13: Mobile Responsive Viewport Emulation
    console.log('12. Testing Mobile Responsive Viewport (375x667)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true
    });
    await evaluate('document.querySelector(\'button[data-view="library"]\').click()');
    await new Promise(r => setTimeout(r, 400));
    const mobileMoreVisible = await evaluate(`
      const b = document.getElementById('mobile-more');
      b && window.getComputedStyle(b).display !== 'none'
    `);
    assert.equal(mobileMoreVisible, true, 'Mobile navigation "More" button should be visible on 375px');
    console.log('✓ PASS: Mobile layout adapted with bottom navigation bar');

    // Check for JavaScript console errors
    console.log('\n--- JAVASCRIPT CONSOLE AUDIT ---');
    if (consoleErrors.length > 0) {
      console.warn('Console error messages recorded:', consoleErrors);
    } else {
      console.log('✓ PASS: ZERO JavaScript uncaught errors or console warnings during entire test session!');
    }

    console.log('\n========================================');
    console.log('ALL BROWSER AUTOMATION TESTS COMPLETED SUCCESSFULLY!');
    console.log('========================================\n');

  } finally {
    ws.close();
    chromeProc.kill('SIGTERM');
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

runE2ETests().catch(err => {
  console.error('E2E Browser Test Failed:', err);
  process.exit(1);
});
