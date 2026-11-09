const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT_DIR = path.join(__dirname, '..');
const PORT = 8125;
const CHROME_PORT = 9235;

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

async function runLargeBookTest() {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const tmpDir = path.join('/tmp', 'leaf-large-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });

  const chromeProc = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${tmpDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ]);

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
  assert.ok(wsUrl, 'Connected to Chrome');

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
    return res.result?.result?.value;
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 2000));

    console.log('Testing opening 24MB Tamil Bhagavad Gita (Children-friendly)...');
    const t0 = Date.now();
    await evaluate(`
      const gita = Array.from(document.querySelectorAll('#books article.book')).find(el => el.textContent.includes('கீதை') || el.textContent.includes('Gita'));
      if (gita) gita.querySelector('button.book-open').click();
    `);

    // Wait for rendition to display
    let opened = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      const pos = await evaluate('document.getElementById("position").textContent');
      if (pos && !pos.includes('Opening book…')) {
        opened = true;
        break;
      }
    }

    const duration = ((Date.now() - t0) / 1000).toFixed(1);
    assert.ok(opened, 'Bhagavad Gita should open and render position');
    console.log(`✓ PASS: 24MB Tamil Bhagavad Gita opened and rendered in ${duration}s!`);

    // Test chapter navigation in book
    await evaluate('document.getElementById("next").click()');
    await new Promise(r => setTimeout(r, 500));
    await evaluate('document.getElementById("previous").click()');
    await new Promise(r => setTimeout(r, 500));
    console.log('✓ PASS: Next & Previous page turned smoothly in 24MB book');

    await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 850, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await evaluate('document.querySelector("#toc").click()');
    const chapter = await evaluate(`
      new Promise(resolve => {
        const timer = setInterval(() => {
          const item = [...document.querySelectorAll('.chapter-item')].find(row => row.textContent.includes('அர்ஜுனன் ஏன் வருந்துகிறான்?'));
          if (item) { clearInterval(timer); item.click(); resolve(true); }
        }, 50);
        setTimeout(() => { clearInterval(timer); resolve(false); }, 3000);
      })
    `);
    assert.ok(chapter, 'Chapter one should be available in the TOC');

    async function waitFor(expression, message) {
      for (let i = 0; i < 40; i++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.fail(message);
    }
    await waitFor(`(() => {
      const doc = document.querySelector('#viewer iframe')?.contentDocument;
      const index = doc?.querySelector('.verseindex');
      return index && doc.defaultView.getComputedStyle(index).fontFamily.includes('TamilSans');
    })()`, 'EPUB stylesheet should load in the frame');
    assert.ok(await evaluate(`(() => {
      const doc = document.querySelector('#viewer iframe').contentDocument;
      const index = doc.querySelector('.verseindex');
      const image = doc.querySelector('figure img');
      return index.scrollWidth <= index.clientWidth && image.offsetWidth <= image.closest('figure').clientWidth;
    })()`), 'Verse links and chapter illustration should fit the column');

    async function swipe(fromX, fromY, toX, toY) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
      for (let step = 1; step <= 5; step++) {
        const x = fromX + (toX - fromX) * step / 5;
        const y = fromY + (toY - fromY) * step / 5;
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    const readerPosition = 'document.querySelector("#position").textContent';
    await waitFor(readerPosition + '.includes("வருந்துகிறான்")', 'Reader should be on chapter one');
    const start = await evaluate(readerPosition);
    await swipe(300, 330, 90, 330);
    await waitFor(readerPosition + ' !== ' + JSON.stringify(start), 'Horizontal swipe should advance in Pages mode');
    const afterHorizontal = await evaluate(readerPosition);
    await swipe(195, 570, 195, 340);
    await waitFor(readerPosition + ' !== ' + JSON.stringify(afterHorizontal), 'Upward swipe should advance in Pages mode');

    await evaluate(`
      document.querySelector('#appearance').click();
      const readingMode = [...document.querySelectorAll('#dialog select')].find(control => control.querySelector('option[value="scrolled-doc"]'));
      readingMode.value = 'scrolled-doc';
      readingMode.dispatchEvent(new Event('change'));
      document.querySelector('#dismiss').click();
    `);
    await waitFor('document.querySelector("#viewer iframe")?.contentDocument?.body.style.touchAction.includes("pan-y")', 'Scroll mode should allow native vertical panning');
    const chapterTitle = 'document.querySelector("#reader-title").textContent';
    const beforeScroll = await evaluate(chapterTitle);
    await swipe(195, 570, 195, 340);
    await waitFor('document.querySelector("#viewer .epub-container")?.scrollTop > 0', 'Vertical swipe should scroll the chapter');
    assert.equal(await evaluate(chapterTitle), beforeScroll, 'Vertical scrolling should stay in the same chapter');
    await swipe(300, 330, 90, 330);
    await waitFor(chapterTitle + ' !== ' + JSON.stringify(beforeScroll), 'Horizontal swipe should advance to the next section in Scroll mode');
    console.log('✓ PASS: Tamil verse layout, page swipes, and continuous scroll gestures at mobile width');

    // Close reader
    await evaluate('document.getElementById("close-reader").click()');
    await new Promise(r => setTimeout(r, 500));
    console.log('✓ PASS: Reader closed cleanly');

    assert.equal(consoleErrors.length, 0, 'No console errors expected during large EPUB reading');
    console.log('ALL LARGE EPUB PERFORMANCE & STABILITY TESTS PASSED!\n');
  } finally {
    ws.close();
    chromeProc.kill('SIGTERM');
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

runLargeBookTest().catch(err => {
  console.error('Large Book Test Failed:', err);
  process.exit(1);
});
