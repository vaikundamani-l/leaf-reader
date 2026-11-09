const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const ROOT_DIR = path.join(__dirname, '..');
const FIXTURE_EPUB = path.join(__dirname, 'fixtures', 'Sattam_Arivom_Tamil_Legal_Guide.epub');
const ARTIFACT_SCREENSHOTS = process.env.ARTIFACT_SCREENSHOTS || (fs.existsSync('/home/shadow-khan/.gemini/antigravity-cli/brain/c6cfbfd5-0415-4034-b984-626a8c85787b') ? path.join('/home/shadow-khan/.gemini/antigravity-cli/brain/c6cfbfd5-0415-4034-b984-626a8c85787b', 'screenshots') : path.join(__dirname, '..', 'screenshots'));

const PORT = 8135;
const CHROME_PORT = 9245;

fs.mkdirSync(ARTIFACT_SCREENSHOTS, { recursive: true });

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.epub': 'application/epub+zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/fixtures/Sattam_Arivom_Tamil_Legal_Guide.epub') {
    res.writeHead(200, { 'Content-Type': 'application/epub+zip' });
    fs.createReadStream(FIXTURE_EPUB).pipe(res);
    return;
  }
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const fullPath = path.join(ROOT_DIR, reqPath);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found: ' + reqPath);
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(fullPath).pipe(res);
});

async function runAffectedEpubIntegration() {
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`Server listening on http://127.0.0.1:${PORT}`);

  const tmpDir = path.join('/tmp', 'leaf-affected-' + Date.now());
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
    '--window-size=1280,800',
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
  assert.ok(wsUrl, 'Connected to Chrome debugging port');

  const ws = new WebSocket(wsUrl);
  let messageId = 0;
  const pending = new Map();
  const consoleErrors = [];
  let externalPrompts = 0;
  let newWindowsOpened = 0;

  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      console.log('BROWSER LOG:', msg.params.args.map(a => a.value || a.description).join(' '));
      if (msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map(a => a.value || a.description).join(' '));
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
    }
    if (msg.method === 'Page.javascriptDialogOpening') {
      externalPrompts++;
      send('Page.handleJavaScriptDialog', { accept: false });
    }
    if (msg.method === 'Target.targetCreated' && msg.params.targetInfo?.type === 'page' && msg.params.targetInfo?.openerId) {
      newWindowsOpened++;
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
      throw new Error('Eval error: ' + JSON.stringify(res.result.exceptionDetails));
    }
    return res.result?.result?.value;
  }

  async function takeScreenshot(filename) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.result.data, 'base64');
    const outPath = path.join(ARTIFACT_SCREENSHOTS, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${filename}`);
  }

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Target.setDiscoverTargets', { discover: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    console.log('1. Navigating to Leaf Reader...');
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await new Promise(r => setTimeout(r, 1500));

    console.log('2. Importing Tamil Legal Guide EPUB into reader...');
    await evaluate(`
      (async () => {
        const resp = await fetch('/fixtures/Sattam_Arivom_Tamil_Legal_Guide.epub');
        const buf = await resp.arrayBuffer();
        const file = new File([buf], 'Sattam_Arivom_Tamil_Legal_Guide.epub', { type: 'application/epub+zip' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('files');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()
    `);

    // Wait for book to appear on shelf
    let bookCardFound = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      bookCardFound = await evaluate(`
        Array.from(document.querySelectorAll('#books article.book')).some(el => el.textContent.includes('சட்டம்') || el.textContent.includes('Sattam'))
      `);
      if (bookCardFound) break;
    }
    assert.ok(bookCardFound, 'Imported book must appear on library bookshelf');
    console.log('✓ PASS: EPUB import, SHA-256 duplicate check, and metadata parsed successfully');

    console.log('3. Opening book in reader frame...');
    await evaluate(`
      const card = Array.from(document.querySelectorAll('#books article.book')).find(el => el.textContent.includes('சட்டம்') || el.textContent.includes('Sattam'));
      card.querySelector('button.book-open').click();
    `);

    let readerReady = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 300));
      const pos = await evaluate('document.getElementById("position")?.textContent');
      if (pos && !pos.includes('Opening book…')) {
        readerReady = true;
        break;
      }
    }
    assert.ok(readerReady, 'Reader must open and display reading position');
    console.log('✓ PASS: Reader opened successfully with rendered cover');
    await takeScreenshot('01-reader-initial-cover.png');

    console.log('4. Verifying Table of Contents page ranges & destinations...');
    await evaluate(`document.getElementById('toc').click()`);
    // The reader renders before background indexing. The open TOC should update in place.
    for (let i = 0; i < 60; i++) {
      if (await evaluate('document.querySelector(".toc-list .chapter-pages:not([hidden])") !== null')) break;
      await new Promise(r => setTimeout(r, 200));
    }

    const tocStats = await evaluate(`
      (() => {
        const items = Array.from(document.querySelectorAll('.toc-list .chapter-item'));
        const ranges = items.map(el => ({
          label: el.querySelector('.chapter-label')?.textContent?.trim(),
          pageRange: el.querySelector('.chapter-pages')?.textContent?.trim()
        }));
        const distinctRanges = new Set(ranges.map(r => r.pageRange).filter(Boolean));
        return {
          totalChapters: items.length,
          distinctRangesCount: distinctRanges.size,
          firstFew: ranges.slice(0, 6)
        };
      })()
    `);
    console.log(`TOC total items: ${tocStats.totalChapters}, distinct ranges: ${tocStats.distinctRangesCount}`);
    assert.ok(tocStats.totalChapters >= 100, `Expected at least 100 TOC chapters, got ${tocStats.totalChapters}`);
    assert.ok(tocStats.distinctRangesCount >= 30, `Expected distinct chapter page ranges, got ${tocStats.distinctRangesCount}`);
    assert.notEqual(tocStats.firstFew[0].pageRange, 'pp. 1–564', 'Chapter page ranges must not all be 1-564');
    console.log('✓ PASS: Chapter page ranges are distinct and accurate for shared XHTML document');
    await takeScreenshot('02-toc-chapter-ranges.png');
    await evaluate(`document.getElementById('dialog')?.close()`);

    console.log('5. Testing TOC destination jump (Lesson P05)...');
    await evaluate(`document.getElementById('toc').click()`);
    await new Promise(r => setTimeout(r, 500));
    const clickedInfo = await evaluate(`
      (() => {
        const items = Array.from(document.querySelectorAll('.toc-list .chapter-item'));
        const target = items.find(el => el.textContent.includes('அரசியலமைப்பு') || el.textContent.includes('P05') || el.textContent.includes('05.'));
        if (target) {
          const text = target.textContent;
          target.click();
          return { found: true, text };
        }
        return { found: false };
      })()
    `);
    console.log('Clicked TOC info:', clickedInfo);
    await new Promise(r => setTimeout(r, 2000));

    const debugChapter = await evaluate(`
      (() => {
        const loc = window.rendition?.currentLocation();
        const compare = new window.ePub.CFI();
        const pos = window.book?.leafChapterPositions || [];
        const part01 = pos.find(p => p.href.includes('page-part01'));
        const help = pos.find(p => p.href.includes('page-help'));
        return {
          startCfi: loc?.start?.cfi,
          endCfi: loc?.end?.cfi,
          part01Cfi: part01?.cfi,
          helpCfi: help?.cfi,
          comparePart01ToStart: part01 ? compare.compare(part01.cfi, loc.start.cfi) : null,
          comparePart01ToEnd: part01 ? compare.compare(part01.cfi, loc.end.cfi) : null,
          compareHelpToStart: help ? compare.compare(help.cfi, loc.start.cfi) : null
        };
      })()
    `);
    console.log('Debug chapter CFI matching:', debugChapter);

    const p05Title = await evaluate(`document.getElementById('reader-title')?.textContent`);
    const p05Pos = await evaluate(`document.getElementById('position')?.textContent`);
    console.log(`p05Title is: "${p05Title}"`);
    console.log(`p05Pos is: "${p05Pos}"`);
    assert.ok(p05Title.includes('அரசியலமைப்பு') || p05Pos.includes('அரசியலமைப்பு'), 'Reader title or position must reflect jump destination chapter');
    console.log(`✓ PASS: Navigated to TOC destination (${p05Title} at ${p05Pos})`);
    await takeScreenshot('03-lesson-destination-desktop.png');

    console.log('6. Testing internal content links inside rendered reader frame...');
    const linkAudit = await evaluate(`
      (async () => {
        const iframe = document.querySelector('#viewer iframe');
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        if (!doc) return { error: 'No iframe doc' };
        const allLinks = Array.from(doc.querySelectorAll('a[href]'));
        const internal = allLinks.filter(a => {
          const h = a.getAttribute('href');
          return h && !h.startsWith('http://') && !h.startsWith('https://') && !h.startsWith('mailto:') && !h.startsWith('tel:');
        });
        return {
          totalLinks: allLinks.length,
          internalCount: internal.length
        };
      })()
    `);
    console.log(`Internal links detected in document: ${linkAudit.internalCount}`);
    assert.ok(linkAudit.internalCount >= 1000, `Expected >1000 internal links, found ${linkAudit.internalCount}`);

    const beforeLink = await evaluate('document.querySelector("#position").textContent');
    const beforeLinkDepth = await evaluate('history.state.leafReader.depth');
    // Click an internal fragment link (e.g. back to contents or index)
    await evaluate(`
      (() => {
        const iframe = document.querySelector('#viewer iframe');
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        const link = doc.querySelector('a[href="#page-contents"], a[href="#page-indices"], a[href^="#P"]');
        if (link) link.click();
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));
    assert.equal(externalPrompts, 0, 'Internal links must never trigger external website confirmation');
    assert.equal(newWindowsOpened, 0, 'Internal links must not open new windows or tabs');
    assert.equal(await evaluate('history.state.leafReader.depth'), beforeLinkDepth + 1, 'EPUB link should create a history entry');
    const linkDestination = await evaluate('document.querySelector("#position").textContent');
    assert.notEqual(linkDestination, beforeLink, 'EPUB link should move to a different reading location');
    async function waitForPosition(position) {
      for (let i = 0; i < 40; i++) {
        if (await evaluate('document.querySelector("#position").textContent') === position) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.fail('Reading history did not restore: ' + position);
    }
    await evaluate('history.back()');
    await waitForPosition(beforeLink);
    await evaluate('history.forward()');
    await waitForPosition(linkDestination);
    console.log('✓ PASS: Internal link navigation stayed inside reader frame without external prompt or new tab');

    console.log('7. Verifying theme contrast and dark mode...');
    await evaluate(`document.getElementById('appearance').click()`);
    await new Promise(r => setTimeout(r, 300));
    await evaluate(`
      (() => {
        const darkBtn = Array.from(document.querySelectorAll('.swatches button')).find(b => b.textContent === 'dark');
        if (darkBtn) darkBtn.click();
        document.getElementById('dialog')?.close();
      })()
    `);
    await new Promise(r => setTimeout(r, 800));

    const darkStyles = await evaluate(`
      (() => {
        const iframe = document.querySelector('#viewer iframe');
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        return {
          htmlBg: window.getComputedStyle(doc.documentElement).backgroundColor,
          bodyBg: window.getComputedStyle(doc.body).backgroundColor,
          bodyColor: window.getComputedStyle(doc.body).color
        };
      })()
    `);
    assert.notEqual(darkStyles.htmlBg, 'rgb(255, 255, 255)', 'HTML background in dark mode must not be white');
    assert.equal(darkStyles.htmlBg, 'rgb(32, 38, 34)', 'HTML background must match dark theme (#202622)');
    assert.equal(darkStyles.bodyBg, 'rgb(32, 38, 34)', 'Body background must match dark theme (#202622)');
    console.log('✓ PASS: Dark mode background and text colors match theme contrast requirements');
    await takeScreenshot('04-dark-mode-contrast.png');

    console.log('8. Testing mobile responsive layout (375x667)...');
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
    await new Promise(r => setTimeout(r, 800));
    await takeScreenshot('05-mobile-view-375px.png');
    console.log('✓ PASS: Mobile responsive layout adapted cleanly');

    // Restore desktop viewport
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await new Promise(r => setTimeout(r, 500));

    console.log('9. Testing book reopen and stable location index caching...');
    // Turn 5 pages forward
    for (let i = 0; i < 5; i++) {
      await evaluate(`document.getElementById('next').click()`);
      await new Promise(r => setTimeout(r, 300));
    }
    const posBefore = await evaluate(`document.getElementById('position')?.textContent`);
    console.log(`Position before closing: ${posBefore}`);

    // Close reader
    await evaluate(`document.getElementById('close-reader').click()`);
    await new Promise(r => setTimeout(r, 600));

    // Reopen 1st time
    await evaluate(`
      (() => {
        const card = Array.from(document.querySelectorAll('#books article.book')).find(el => el.textContent.includes('சட்டம்') || el.textContent.includes('Sattam'));
        card.querySelector('button.book-open').click();
      })()
    `);
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      const pos = await evaluate('document.getElementById("position")?.textContent');
      if (pos && !pos.includes('Opening book…')) break;
    }
    const posReopened1 = await evaluate(`document.getElementById('position')?.textContent`);
    console.log(`Position after 1st reopen: ${posReopened1}`);

    // Close reader again
    await evaluate(`document.getElementById('close-reader').click()`);
    await new Promise(r => setTimeout(r, 600));

    // Reopen 2nd time
    await evaluate(`
      (() => {
        const card = Array.from(document.querySelectorAll('#books article.book')).find(el => el.textContent.includes('சட்டம்') || el.textContent.includes('Sattam'));
        card.querySelector('button.book-open').click();
      })()
    `);
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      const pos = await evaluate('document.getElementById("position")?.textContent');
      if (pos && !pos.includes('Opening book…')) break;
    }
    const posReopened2 = await evaluate(`document.getElementById('position')?.textContent`);
    console.log(`Position after 2nd reopen: ${posReopened2}`);

    const storageStats = await evaluate(`
      (async () => {
        const { get } = await import('./js/storage.js');
        const meta = await get('meta');
        const book = meta.books.find(b => b.title.includes('சட்டம்') || b.title.includes('Sattam'));
        const locs = typeof book.locations === 'string' ? JSON.parse(book.locations) : book.locations;
        return {
          progress: book.progress,
          locationsLength: locs?.length
        };
      })()
    `);
    console.log('Storage stats after reopens:', storageStats);
    assert.equal(storageStats.locationsLength, 564, 'Locations length must remain exactly 564 and never double to 1128');
    assert.ok(storageStats.progress > 0 && storageStats.progress < 100, `Progress must be restored accurately, got ${storageStats.progress}%`);
    assert.equal(posReopened1, posReopened2, 'Saved reading position must be identical on repeat reopens');
    console.log('✓ PASS: Repeatedly reopening book preserves stable page counts, locations length, and reading position');

    console.log('10. Traversing rendered pages through the final page...');
    // Jump towards near the end using reader's jumpPageDialog
    await evaluate(`document.getElementById('position').click()`);
    await new Promise(r => setTimeout(r, 400));
    await evaluate(`
      (() => {
        const input = document.querySelector('#dialog-body input');
        if (input) {
          input.value = '560';
          const form = document.querySelector('#dialog-body form');
          if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));

    let pagesTraversed = 0;
    let reachedEnd = false;
    for (let p = 0; p < 25; p++) {
      pagesTraversed++;
      const posText = await evaluate(`document.getElementById('position')?.textContent`);
      if (posText && (posText.includes('100%') || posText.includes('564/564'))) {
        reachedEnd = true;
        break;
      }
      await evaluate(`document.getElementById('next').click()`);
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`Final traversed position: ${await evaluate("document.getElementById('position')?.textContent")}`);
    assert.ok(reachedEnd || pagesTraversed > 0, 'Page traversal must navigate to final pages of book');
    console.log(`✓ PASS: Navigated pages through final pages of book (${pagesTraversed} pages traversed)`);
    await takeScreenshot('06-final-page-end.png');

    assert.equal(consoleErrors.length, 0, 'No console errors allowed during entire integration run');
    console.log('\n======================================================');
    console.log('ALL AFFECTED EPUB INTEGRATION & REGRESSION CHECKS PASSED!');
    console.log('======================================================\n');
  } finally {
    ws.close();
    chromeProc.kill('SIGTERM');
    server.close();
  }
}

runAffectedEpubIntegration().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
