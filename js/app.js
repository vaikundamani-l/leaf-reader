import { installBookLinks, prepareBookChapters, restoreBookLocations } from './book-navigation.js';
import { get, put, remove } from './storage.js';

const $ = s => document.querySelector(s);
const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('');

let readerRequest = 0;
let books = [], annotations = [], vocabulary = [], sessions = [];
let current = null, book = null, rendition = null, selected = null;
let view = 'library', query = '', sort = 'recent', list = false, filter = 'all';
let activity = Date.now();
let statsPeriod = 'daily';

let prefs = {
  font: 'Georgia',
  size: 19,
  line: 1.7,
  width: 850,
  theme: 'paper',
  flow: 'paginated',
  spread: 'none',
  target: 'ta',
  weight: 400,
  letter: 0,
  word: 0,
  paragraph: 1,
  align: 'left',
  margin: 20
};

const palettes = {
  light: ['#ffffff', '#263d31'],
  paper: ['#f7f8f4', '#263d31'],
  sepia: ['#f4ead5', '#4b3b27'],
  dark: ['#202622', '#dce4da'],
  oled: ['#000000', '#eeeeee']
};

const langs = {
  ta: 'Tamil',
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
  te: 'Telugu',
  kn: 'Kannada',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese'
};

const demos = [
  { id: 'demo-garden', title: 'The Secret Garden', author: 'Frances Hodgson Burnett', color: '#cbd2bd', symbol: '❧', path: 'garden.epub' },
  { id: 'demo-walden', title: 'Walden', author: 'Henry David Thoreau', color: '#485c50', ink: '#e9e6cf', symbol: '♧', path: 'walden.epub' },
  { id: 'demo-pride', title: 'Pride and Prejudice', author: 'Jane Austen', color: '#e3d5c7', symbol: '❦', path: 'pride.epub' },
  { id: 'demo-alice', title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll', color: '#b1c4ca', symbol: '♠', path: 'alice.epub' },
  { id: 'demo-room', title: 'The Art of Slowing Down', author: 'Leaf Reader', color: '#d6bbad', symbol: '◒', path: 'room.epub' },
  { id: 'demo-siddhartha', title: 'Siddhartha', author: 'Hermann Hesse', color: '#d3bc7b', symbol: '☼', path: 'siddhartha.epub' },
  { id: 'demo-gita-children', title: 'பகவத் கீதை (சிறுவர் பதிப்பு)', author: 'சி. சுப்ரமணிய பாரதியார்', color: '#c27b38', ink: '#fff9ee', symbol: 'ॐ', path: 'Bhagavad-Gita-Tamil-Children-Friendly.epub', language: 'ta' },
  { id: 'demo-sattam-arivom', title: 'சட்டம் அறிவோம்', author: 'சட்ட வழிகாட்டி', color: '#3d5a80', ink: '#f0f4f8', symbol: '⚖', path: 'Sattam_Arivom_Tamil_Legal_Guide.epub', language: 'ta' }
].map(b => ({ ...b, demo: true, progress: 0, added: 0 }));

function toast(t) {
  const elToast = $('#toast');
  if (!elToast) return;
  elToast.textContent = t;
  elToast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => elToast.classList.remove('show'), 3500);
}

function dialog(title) {
  const titleEl = $('#dialog-title');
  const bodyEl = $('#dialog-body');
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.replaceChildren();
  const d = $('#dialog');
  if (d && !d.open) d.showModal();
  sizeMobileDialog();
  return bodyEl;
}

function sizeMobileDialog() {
  const viewport = window.visualViewport;
  const modal = $('#dialog');
  if (!viewport || !modal?.open) return;
  modal.style.setProperty('--dialog-bottom', Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) + 'px');
  modal.style.setProperty('--dialog-viewport-height', viewport.height + 'px');
}
window.visualViewport?.addEventListener('resize', sizeMobileDialog);
window.visualViewport?.addEventListener('scroll', sizeMobileDialog);

function btn(t, fn, cls) {
  const b = el('button', t, cls);
  if (t === '♡' || t === '♥') b.setAttribute('aria-label', t === '♥' ? 'Remove favorite' : 'Add favorite');
  if (t === '•••') b.setAttribute('aria-label', 'Book options');
  b.onclick = fn;
  return b;
}

function field(parent, label, input) {
  const l = el('label', undefined, 'field');
  l.append(el('span', label), input);
  parent.append(l);
  return input;
}

function download(data, name, type = 'application/json') {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

async function save() {
  await put('meta', { books, annotations, vocabulary, sessions, prefs });
}

function safe(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Something went wrong. Please try again.');
    }
  };
}

window.addEventListener('unhandledrejection', e => {
  toast(e.reason?.message || 'Unable to complete that action.');
  e.preventDefault();
});

const dismissBtn = $('#dismiss');
if (dismissBtn) dismissBtn.onclick = () => $('#dialog')?.close();

function cover(b) {
  const c = el('div', undefined, 'cover');
  c.style.background = b.color || '#cbd2bd';
  c.style.color = b.ink || '#344c3a';
  if (b.cover && typeof b.cover === 'string' && (/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(b.cover) || /^blob:/i.test(b.cover))) {
    const img = el('img');
    img.src = b.cover;
    img.alt = b.title ? `Cover of ${b.title}` : '';
    c.append(img);
  } else {
    c.append(
      el('span', b.title, 'cover-title'),
      el('span', b.symbol || '❧', 'cover-symbol'),
      el('span', (b.author || 'UNKNOWN AUTHOR').toUpperCase(), 'cover-author')
    );
  }
  return c;
}

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const countEl = $('#count');
  if (countEl) countEl.textContent = books.length;
  const c = $('#content');
  if (!c) return;
  c.replaceChildren();
  if (['library', 'reading', 'favorites', 'completed'].includes(view)) renderLibrary(c);
  else if (view === 'settings') settingsPage(c);
  else if (view === 'statistics') stats(c);
  else savedPage(c);
}

function renderLibrary(c) {
  const heading = {
    library: 'A little space to get lost.',
    reading: 'Pick up where you left off.',
    favorites: 'The books you come back to.',
    completed: 'Every ending, a new beginning.'
  };
  c.append(el('h1', heading[view] || heading.library), el('p', 'Your stories, your pace. Make yourself at home.', 'subtitle'));

  const last = [...books].filter(b => b.opened).sort((a, b) => b.opened - a.opened)[0] || books[0];
  if (last && view === 'library') {
    const hero = el('section', undefined, 'hero'), info = el('div');
    info.append(
      el('p', last.opened ? 'CONTINUE YOUR JOURNEY' : 'A GOOD PLACE TO BEGIN', 'eyebrow'),
      el('h2', last.title),
      el('p', last.author)
    );
    const bar = el('div', undefined, 'hero-progress'), fill = el('i');
    fill.style.width = Math.min(100, Math.max(0, last.progress || 0)) + '%';
    bar.append(fill);
    info.append(
      bar,
      el('p', last.opened ? `${Math.round(last.progress || 0)}% read · Your place is saved` : 'Open a sample, or import a book of your own'),
      btn(last.opened ? 'Continue reading  →' : 'Start reading  →', () => openBook(last), 'primary')
    );
    hero.append(cover(last), info, el('div', '❧', 'hero-art'));
    c.append(hero);
  }

  const tools = el('div', undefined, 'tools'), right = el('div', undefined, 'tools-right');
  tools.append(el('h2', view === 'library' ? 'Your bookshelf' : view === 'reading' ? 'Currently reading' : view === 'favorites' ? 'Favorites' : 'Completed'));

  const search = el('input');
  search.type = 'search';
  search.placeholder = '⌕  Search your books';
  search.value = query;
  search.setAttribute('aria-label', 'Search your books');
  search.oninput = () => { query = search.value; drawGrid(); };

  const order = el('select');
  order.setAttribute('aria-label', 'Sort books');
  for (const [v, t] of [['recent', 'Recently added'], ['title', 'Title A–Z'], ['author', 'Author A–Z'], ['progress', 'Reading progress']]) {
    const o = el('option', t);
    o.value = v;
    order.append(o);
  }
  order.value = sort;
  order.onchange = () => { sort = order.value; drawGrid(); };

  right.append(search, order, btn(list ? '▦' : '☰', () => { list = !list; render(); }));
  tools.append(right);
  c.append(tools);

  const tabs = el('div', undefined, 'tabs');
  for (const [v, t] of [['all', 'All books'], ['own', 'My imports'], ['demo', 'Sample shelf']]) {
    tabs.append(btn(t, () => { filter = v; render(); }, filter === v ? 'active' : ''));
  }
  c.append(tabs);

  const collections = [...new Set(books.map(b => b.collection).filter(Boolean))];
  if (collections.length) {
    const cs = el('select');
    cs.setAttribute('aria-label', 'Filter by collection');
    const all = el('option', 'All collections');
    all.value = '';
    cs.append(all);
    collections.forEach(t => {
      const o = el('option', t);
      o.value = t;
      cs.append(o);
    });
    cs.value = window.leafCollection || '';
    cs.onchange = () => { window.leafCollection = cs.value; drawGrid(); };
    c.append(cs);
  }

  const grid = el('div');
  grid.id = 'books';
  c.append(grid);
  drawGrid();
}

function drawGrid() {
  const grid = $('#books');
  if (!grid) return;
  grid.className = list ? 'list' : 'grid';
  grid.replaceChildren();

  let shown = books.filter(b =>
    (!window.leafCollection || b.collection === window.leafCollection) &&
    (view !== 'favorites' || b.favorite) &&
    (view !== 'completed' || b.completed) &&
    (view !== 'reading' || (b.opened && !b.completed)) &&
    (filter !== 'own' || !b.demo) &&
    (filter !== 'demo' || b.demo) &&
    `${b.title || ''} ${b.author || ''}`.toLowerCase().includes(query.toLowerCase())
  );

  shown.sort((a, b) => {
    if (sort === 'title') return (a.title || '').localeCompare(b.title || '');
    if (sort === 'author') return (a.author || '').localeCompare(b.author || '');
    if (sort === 'progress') return (b.progress || 0) - (a.progress || 0);
    return (b.added || 0) - (a.added || 0);
  });

  for (const b of shown) {
    const card = el('article', undefined, 'book');
    const open = btn('', () => openBook(b), 'book-open');
    const details = el('div');
    details.append(el('h3', b.title || 'Untitled Book'), el('p', b.author || 'Unknown Author'));
    open.append(cover(b), details);

    const meta = el('div', undefined, 'book-meta');
    meta.append(
      el('span', b.demo ? 'SAMPLE · ' + (b.opened ? Math.round(b.progress || 0) + '% read' : 'EPUB') : b.completed ? 'COMPLETED' : b.opened ? Math.round(b.progress || 0) + '% read' : 'READY TO READ'),
      btn(b.favorite ? '♥' : '♡', async () => { b.favorite = !b.favorite; await save(); render(); }),
      btn('•••', () => bookMenu(b))
    );
    card.append(open, meta);
    grid.append(card);
  }

  if (!shown.length) {
    const emptyBox = el('div', undefined, 'empty');
    emptyBox.append(
      el('p', query ? `No books found matching "${query}".` : view === 'favorites' ? 'No favorite books yet. Tap ♡ on any book to add it.' : view === 'completed' ? 'No completed books yet. Finished books will appear here.' : view === 'reading' ? 'No books currently in progress. Pick any book to begin reading.' : 'No books here yet. Import an EPUB or explore sample stories to start your next chapter.'),
      btn('＋ Import an EPUB', () => $('#files')?.click(), 'primary')
    );
    grid.append(emptyBox);
  }
}

function promptDialog(title, label, defaultValue, onConfirm) {
  const d = dialog(title);
  d.className = 'stack';
  const form = el('form');
  form.className = 'stack';
  form.onsubmit = e => {
    e.preventDefault();
    const val = input.value.trim();
    $('#dialog')?.close();
    onConfirm(val);
  };
  form.append(el('label', label));
  const input = el('input');
  input.value = defaultValue || '';
  input.required = true;
  form.append(input, btn('Save', undefined, 'primary'));
  d.append(form);
  setTimeout(() => { input.focus(); input.select(); }, 50);
}

function bookMenu(b) {
  const d = dialog(b.title || 'Book options');
  d.className = 'stack';
  d.append(el('p', [b.author, b.publisher, b.language].filter(Boolean).join(' · ')));
  d.append(
    btn('Set collection', () => {
      promptDialog('Set collection', 'Collection name:', b.collection || '', name => {
        b.collection = name;
        save();
        render();
      });
    }),
    btn('Rename display title', () => {
      promptDialog('Rename title', 'Book title:', b.title, title => {
        if (title) {
          b.title = title;
          save();
          render();
        }
      });
    }),
    btn(b.completed ? 'Mark as unread' : 'Mark as completed', () => {
      b.completed = !b.completed;
      save();
      render();
      $('#dialog')?.close();
    }),
    btn('Remove from this device', async () => {
      if (!confirm('Remove this book and its annotations from this device?')) return;
      if (b.demo) {
        try { localStorage.setItem('removed_' + b.id, '1'); } catch {}
      }
      await remove(b.id);
      books = books.filter(x => x.id !== b.id);
      annotations = annotations.filter(x => x.bookId !== b.id);
      await save();
      render();
      $('#dialog')?.close();
      toast('Book removed from library.');
    })
  );
}

async function importFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      toast('Please choose an EPUB file.');
      continue;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast('Please use an EPUB smaller than 100 MB.');
      continue;
    }
    toast('Importing ' + file.name + '…');
    let temp;
    try {
      const data = await file.arrayBuffer();
      const hash = crypto.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).map(v => v.toString(16).padStart(2, '0')).join('') : null;
      if (hash && books.some(b => b.hash === hash)) {
        toast('This book is already in your library.');
        continue;
      }
      const zip = await JSZip.loadAsync(data);
      const unpacked = Object.values(zip.files).reduce((n, f) => n + (f._data?.uncompressedSize || 0), 0);
      if (unpacked > 350 * 1024 * 1024 || Object.keys(zip.files).length > 15000) throw Error('This EPUB exceeds safe archive limits.');
      if (!zip.file('META-INF/container.xml')) throw Error('This file is not a valid EPUB.');
      temp = ePub(data);
      await temp.ready;
      const m = await temp.loaded.metadata;
      let coverData = null;
      try {
        const url = await temp.coverUrl();
        if (url) {
          const blob = await (await fetch(url)).blob();
          if (blob.type.startsWith('image/')) {
            coverData = await new Promise(resolve => {
              const r = new FileReader();
              r.onload = () => resolve(r.result);
              r.readAsDataURL(blob);
            });
          }
        }
      } catch {}
      const id = uid();
      await put(id, data);
      books.unshift({
        id,
        hash,
        title: m.title || file.name.replace(/\.epub$/i, ''),
        author: m.creator || 'Unknown author',
        language: m.language,
        publisher: m.publisher,
        cover: coverData,
        added: Date.now(),
        progress: 0
      });
      await save();
      toast('Book added to your shelf.');
    } catch (e) {
      toast('Could not import ' + file.name + ': ' + e.message);
    } finally {
      temp?.destroy();
    }
  }
  render();
}

const importBtn = $('#import');
if (importBtn) importBtn.onclick = () => $('#files')?.click();
const filesInput = $('#files');
if (filesInput) filesInput.onchange = e => importFiles(e.target.files);

document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop'); });
document.addEventListener('dragleave', () => document.body.classList.remove('drop'));
document.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('drop');
  if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
});

document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; render(); });

const mobileMoreBtn = $('#mobile-more');
if (mobileMoreBtn) {
  mobileMoreBtn.onclick = () => {
    const d = dialog('More in Leaf Reader');
    d.className = 'stack';
    for (const [v, t] of [['favorites', 'Favorites'], ['completed', 'Completed'], ['vocabulary', 'Vocabulary'], ['statistics', 'Reading insights'], ['settings', 'Settings & backup']]) {
      d.append(btn(t, () => { view = v; render(); $('#dialog')?.close(); }));
    }
  };
}

function getFlatToc(items = [], depth = 0, flat = []) {
  for (const item of items) {
    flat.push({ ...item, depth });
    if (item.subitems && item.subitems.length) getFlatToc(item.subitems, depth + 1, flat);
  }
  return flat;
}

function getTocWithPages(bookInstance, nav) {
  const flat = getFlatToc(nav?.toc || []);
  if (!flat.length) return [];
  const hasLocations = Boolean(bookInstance?.locations?.length());
  const totalPages = hasLocations ? bookInstance.locations.length() : (bookInstance?.spine?.length || 1);
  for (const entry of flat) {
    const sec = bookInstance?.spine?.get(entry.href);
    entry.spineIndex = sec ? sec.index : -1;
    entry.startLoc = null;
    if (hasLocations && sec) {
      const posItem = bookInstance.leafChapterPositions?.find(p => p.href === entry.href);
      const cfi = posItem?.cfi || (!entry.href.includes('#') ? `epubcfi(${sec.cfiBase}!/4/2/1:0)` : null);
      if (cfi) {
        try {
          const loc = bookInstance.locations.locationFromCfi(cfi);
          if (loc >= 0) entry.startLoc = loc;
        } catch {}
      }
    }
  }
  for (let i = 0; i < flat.length; i++) {
    const curr = flat[i];
    if (hasLocations && curr.startLoc !== null) {
      const next = flat.slice(i + 1).find(e => e.startLoc !== null && e.startLoc > curr.startLoc);
      const startPage = curr.startLoc + 1;
      let endPage = (next && next.startLoc !== null) ? next.startLoc : totalPages;
      if (endPage < startPage) endPage = startPage;
      curr.startPage = startPage;
      curr.endPage = endPage;
      curr.pageRange = startPage === endPage ? `p. ${startPage}` : `pp. ${startPage}–${endPage}`;
    } else if (curr.spineIndex >= 0) {
      const next = flat.slice(i + 1).find(e => e.spineIndex >= 0 && e.spineIndex > curr.spineIndex);
      const startSec = curr.spineIndex + 1;
      const endSec = (next && next.spineIndex >= 0) ? next.spineIndex : totalPages;
      curr.startPage = startSec;
      curr.endPage = Math.max(startSec, endSec);
      curr.pageRange = startSec === endSec ? `p. ${startSec}` : `pp. ${startSec}–${endSec}`;
    } else {
      curr.pageRange = '';
    }
  }
  return flat;
}

function getActiveChapter(bookInstance, nav, loc) {
  if (!nav?.toc?.length) return null;
  const flat = getFlatToc(nav.toc);
  if (loc?.start?.cfi && bookInstance?.leafChapterPositions?.length) {
    try {
      const compare = new ePub.CFI();
      const boundaryCfi = loc.end?.cfi || loc.start.cfi;
      let nearest = null;
      for (const item of bookInstance.leafChapterPositions) {
        if (!item.cfi) continue;
        if (compare.compare(item.cfi, boundaryCfi) <= 0) {
          if (!nearest || compare.compare(item.cfi, nearest.cfi) >= 0) {
            nearest = item;
          }
        }
      }
      if (nearest) return nearest;
    } catch {}
  }
  const spineIdx = loc?.start?.index ?? -1;
  const currentLoc = (bookInstance?.locations?.length() && loc?.start?.cfi) ? bookInstance.locations.locationFromCfi(loc.start.cfi) : null;
  if (currentLoc !== null && currentLoc >= 0) {
    let active = null;
    for (const item of flat) {
      const sec = bookInstance.spine?.get(item.href);
      if (sec && !item.href.includes('#')) {
        const locStart = bookInstance.locations.locationFromCfi(`epubcfi(${sec.cfiBase}!/4/2/1:0)`);
        if (locStart >= 0 && locStart <= currentLoc) active = item;
      }
    }
    if (active) return active;
  }
  if (spineIdx >= 0) {
    let active = null;
    for (const item of flat) {
      const sec = bookInstance.spine?.get(item.href);
      if (sec && sec.index <= spineIdx && (!active || (bookInstance.spine?.get(active.href)?.index ?? -1) < sec.index)) {
        active = item;
      }
    }
    if (active) return active;
  }
  return flat[0] || null;
}

async function updateReaderStatus(loc) {
  if (!current || !book) return;
  const statusBook = book;
  const statusCurrent = current;
  let chapterName = '';
  try {
    const nav = await statusBook.loaded.navigation;
    const activeChapter = getActiveChapter(statusBook, nav, loc);
    if (activeChapter?.label) chapterName = activeChapter.label.trim();
  } catch {}
  if (book !== statusBook || current !== statusCurrent) return;
  current.chapter = chapterName;
  const hasLocs = Boolean(book.locations?.length());
  let pageInfo = '';
  if (hasLocs && loc?.start?.cfi) {
    const curLoc = book.locations.locationFromCfi(loc.start.cfi);
    const total = book.locations.length();
    if (curLoc >= 0) pageInfo = `p. ${curLoc + 1}/${total} · `;
  }
  const readerTitle = $('#reader-title');
  if (readerTitle) {
    readerTitle.textContent = chapterName ? `${current.title} — ${chapterName}` : current.title;
    readerTitle.title = readerTitle.textContent;
  }
  const pos = $('#position');
  if (pos) {
    pos.textContent = `${chapterName ? chapterName + ' · ' : ''}${pageInfo}${Math.round(current.progress || 0)}%`;
  }
}

function jumpPageDialog() {
  if (!book || !rendition) return;
  const jumpBook = book;
  const jumpRendition = rendition;
  const d = dialog('Go to page');
  d.className = 'stack';

  const form = el('form', undefined, 'stack');
  form.id = 'jump-page-form';
  const mode = el('select');
  const pageMode = el('option', 'Page');
  pageMode.value = 'page';
  const percentMode = el('option', 'Percentage');
  percentMode.value = 'percent';
  mode.append(pageMode, percentMode);
  field(form, 'Jump by', mode);

  const input = el('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.required = true;
  field(form, 'Destination', input);

  const hint = el('p', undefined, 'muted');
  hint.setAttribute('role', 'status');
  form.append(hint);

  const pageCount = () => jumpBook.leafLocationsReady ? jumpBook.locations.length() : 0;
  function updateLimits() {
    const total = pageCount();
    percentMode.disabled = !total;
    pageMode.textContent = total ? 'Page' : 'Section';
    const isPercent = mode.value === 'percent';
    input.min = isPercent ? '0' : '1';
    input.max = String(isPercent ? 100 : total || jumpBook.spine.length);
    hint.textContent = total
      ? (isPercent ? 'Enter a percentage from 0 to 100.' : `Enter a page from 1 to ${total}.`)
      : 'Pages are being indexed. You can jump to a section in the meantime.';
  }
  function fillCurrent() {
    updateLimits();
    const loc = jumpRendition.currentLocation();
    const total = pageCount();
    const page = total && loc?.start?.cfi ? jumpBook.locations.locationFromCfi(loc.start.cfi) : -1;
    input.value = String(mode.value === 'percent' ? Math.round(current.progress || 0)
      : total ? Math.max(1, page + 1) : (loc?.start?.index ?? 0) + 1);
  }
  mode.onchange = fillCurrent;
  form.addEventListener('leaf:locations-ready', fillCurrent);
  fillCurrent();

  async function jump(destination, byPercent = false) {
    if (book !== jumpBook || rendition !== jumpRendition) return;
    const total = pageCount();
    const target = byPercent
      ? (total ? jumpBook.locations.cfiFromPercentage(destination / 100) : null)
      : total ? jumpBook.locations.cfiFromLocation(destination - 1)
        : jumpBook.spine.get(destination - 1)?.href;
    if (!target) throw Error('This reading position is unavailable.');
    await jumpRendition.display(target);
    if (book === jumpBook && form.isConnected) $('#dialog')?.close();
  }

  form.onsubmit = safe(async e => {
    e.preventDefault();
    await jump(input.valueAsNumber, mode.value === 'percent');
  });

  const quickRow = el('div', undefined, 'swatches');
  const quickJump = (label, fraction) => {
    const button = btn(label, safe(() => {
      const total = pageCount() || jumpBook.spine.length;
      return jump(Math.round((total - 1) * fraction) + 1);
    }));
    button.type = 'button';
    return button;
  };
  quickRow.append(quickJump('Start', 0), quickJump('Middle', 0.5), quickJump('End', 1));
  const submit = btn('Go →', undefined, 'primary');
  submit.type = 'submit';
  form.append(quickRow, submit);
  d.append(form);
  input.focus();
  input.select();
}

async function openBook(b) {
  const request = ++readerRequest;
  let openedBook;
  const active = () => request === readerRequest;
  try {
    current = b;
    $('#reader').hidden = false;
    document.body.style.overflow = 'hidden';
    selected = null;
    $('#reader-title').textContent = b.title;
    $('#position').textContent = 'Opening book…';
    const loader = $('#reader-loading');
    if (loader) {
      loader.hidden = false;
      const lt = $('#reader-loading-text');
      if (lt) lt.textContent = 'Opening ' + (b.title || 'book') + '…';
    }
    try { rendition?.destroy(); } catch {}
    rendition = null;
    try { book?.destroy(); } catch {}
    book = null;
    $('#viewer').replaceChildren();

    const data = b.demo ? await (await fetch('library/' + b.path)).arrayBuffer() : await get(b.id);
    if (!active()) return;
    if (!data) throw Error('Book data is missing. Please import it again.');

    openedBook = ePub(data);
    book = openedBook;
    await openedBook.ready;
    if (!active()) { openedBook.destroy(); return; }

    openedBook.spine.hooks.content.register(doc => {
      const policy = doc.createElement('meta');
      policy.setAttribute('http-equiv', 'Content-Security-Policy');
      policy.setAttribute('content', "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; form-action 'none';");
      doc.querySelectorAll('script,iframe,object,embed,form,base,meta[http-equiv]').forEach(n => n.remove());
      doc.querySelectorAll('*').forEach(n => {
        for (const a of [...n.attributes]) {
          if (/^on/i.test(a.name) || /^(javascript|vbscript):/i.test(a.value.trim())) n.removeAttribute(a.name);
        }
        if (n.tagName.toLowerCase() !== 'a') {
          for (const key of ['src', 'href', 'xlink:href']) {
            if (/^(https?:)?\/\//i.test(n.getAttribute(key) || '')) n.removeAttribute(key);
          }
        }
      });
      doc.head?.prepend(policy);
    });

    rendition = openedBook.renderTo('viewer', {
      width: '100%',
      height: '100%',
      flow: prefs.flow,
      spread: prefs.spread || 'none',
      allowScriptedContent: false
    });

    rendition.hooks.content.register(contents => {
      const doc = contents.document;
      doc.querySelectorAll('script,iframe,object,embed,form').forEach(n => n.remove());
      const section = openedBook.spine.get(contents.sectionIndex !== undefined ? contents.sectionIndex : (contents.cfiBase || contents.section?.href));
      if (section) {
        installBookLinks(doc, section, openedBook, rendition, {
          confirmExternal: msg => confirm(msg || 'Open this external website?'),
          openExternal: href => window.open(href, '_blank', 'noopener,noreferrer'),
          showError: msg => toast(msg)
        });
      }

      doc.addEventListener('keydown', keys);
      doc.addEventListener('pointerdown', () => { activity = Date.now(); });

      updateReadingGestures(contents);
      let touchStart;
      doc.addEventListener('touchstart', e => {
        const touch = e.touches.length === 1 ? e.touches[0] : null;
        touchStart = touch && { id: touch.identifier, x: touch.clientX, y: touch.clientY };
      }, { passive: true });
      doc.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
      doc.addEventListener('touchend', e => {
        const start = touchStart;
        touchStart = null;
        if (!start || e.touches.length || !active() || contents.window.getSelection()?.toString()) return;
        if (e.target.closest?.('input, button, select, textarea, [contenteditable]')) return;
        const touch = Array.from(e.changedTouches).find(t => t.identifier === start.id);
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        const horizontal = Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5;
        const vertical = prefs.flow === 'paginated' && Math.abs(dy) >= 48 && Math.abs(dy) > Math.abs(dx) * 1.5;
        if (!horizontal && !vertical) return;
        if (e.cancelable) e.preventDefault();
        activity = Date.now();
        const rtl = openedBook.package?.metadata?.direction === 'rtl';
        const forward = horizontal ? (rtl ? dx > 0 : dx < 0) : dy < 0;
        if (forward) rendition?.next();
        else rendition?.prev();
      }, { passive: false });

      doc.addEventListener('click', e => {
        if (e.target.closest?.('a, input, button, select, textarea, [contenteditable]')) return;
        if (contents.window.getSelection()?.toString() || prefs.flow !== 'paginated') return;
        const frame = contents.window.frameElement;
        if (!frame) return;
        const bounds = $('#viewer').getBoundingClientRect();
        const x = e.clientX + frame.getBoundingClientRect().left - bounds.left;
        if (x < bounds.width * 0.18) rendition?.prev();
        else if (x > bounds.width * 0.82) rendition?.next();
      });

      doc.addEventListener('selectionchange', () => {
        if (!contents.window.getSelection().toString()) $('#selection').hidden = true;
      });
    });

    rendition.on('selected', (cfi, contents) => {
      if ($('#selection').hidden || selected?.cfi !== cfi) setSelectionExpanded(false);
      selected = { cfi, text: contents.window.getSelection().toString() };
      $('#selection').hidden = !selected.text;
    });

    rendition.on('relocated', loc => {
      if (!active()) return;
      b.cfi = loc.start.cfi;
      selected = null;
      $('#selection').hidden = true;
      b.opened = Date.now();
      if (openedBook.locations.length()) {
        const pct = openedBook.locations.percentageFromCfi(b.cfi);
        if (typeof pct === 'number' && !isNaN(pct)) {
          b.progress = Math.max(0, Math.min(100, pct * 100));
        }
      } else if (b.progress === undefined || b.progress === null) {
        b.progress = Math.max(0, Math.min(100, (loc.start.index / Math.max(1, openedBook.spine.length - 1)) * 100));
      }
      updateReaderStatus(loc);
      save();
    });

    rendition.on('rendered', (section, view) => {
      if (!active()) return;
      const loader = $('#reader-loading');
      if (loader) loader.hidden = true;
      for (const a of annotations.filter(a => a.bookId === b.id && a.type !== 'bookmark')) {
        paint(a);
      }
    });

    applyAppearance();
    const cfiCompare = new ePub.CFI();
    const restoredLocations = restoreBookLocations(openedBook, b.locations, (a, z) => cfiCompare.compare(a, z));
    openedBook.leafLocationsReady = restoredLocations;
    if (!restoredLocations) {
      openedBook.locations._locations = [];
      openedBook.locations.total = 0;
      b.locations = null;
    }

    await rendition.display(b.cfi || undefined);
    if (!active()) { openedBook.destroy(); return; }

    if (loader) loader.hidden = true;

    for (const a of annotations.filter(a => a.bookId === b.id && a.type !== 'bookmark')) {
      paint(a);
    }

    (async () => {
      try {
        const nav = await openedBook.loaded.navigation;
        if (!active()) return;
        await prepareBookChapters(openedBook, nav, active);
        if (active()) updateReaderStatus(rendition?.currentLocation());
      } catch {}
      if (!active()) return;
      if (!restoredLocations) await openedBook.locations.generate(600);
      if (!active()) return;
      openedBook.leafLocationsReady = Boolean(openedBook.locations.length());
      b.locations = openedBook.locations.save();
      const cur = rendition?.currentLocation();
      if (cur?.start?.cfi) {
        b.progress = Math.max(0, Math.min(100, openedBook.locations.percentageFromCfi(cur.start.cfi) * 100));
        updateReaderStatus(cur);
      }
      if ($('#dialog')?.open) {
        if (!restoredLocations && openedBook.leafLocationsReady) {
          $('#jump-page-form')?.dispatchEvent(new Event('leaf:locations-ready'));
        }
        $('.toc-list')?.dispatchEvent(new Event('leaf:locations-ready'));
      }
      save();
    })().catch(() => {});

    activity = Date.now();
  } catch (e) {
    if (!active()) return;
    const loader = $('#reader-loading');
    if (loader) loader.hidden = true;
    toast('Unable to open book: ' + e.message);
    closeReader();
  }
}

function closeReader() {
  readerRequest++;
  if (document.fullscreenElement === document.documentElement) document.exitFullscreen()?.catch(() => {});
  $('#reader').hidden = true;
  document.body.style.overflow = '';
  selected = null;
  $('#selection').hidden = true;
  const loader = $('#reader-loading');
  if (loader) loader.hidden = true;
  stopTTS();
  window.speechSynthesis?.cancel();
  try { rendition?.destroy(); } catch {}
  rendition = null;
  try { book?.destroy(); } catch {}
  book = null;
  current = null;
  render();
}

const closeReaderBtn = $('#close-reader');
if (closeReaderBtn) closeReaderBtn.onclick = closeReader;
const prevBtn = $('#previous');
if (prevBtn) prevBtn.onclick = () => { activity = Date.now(); rendition?.prev(); };
const nextBtn = $('#next');
if (nextBtn) nextBtn.onclick = () => { activity = Date.now(); rendition?.next(); };
const focusBtn = $('#focus');
if (focusBtn) {
  focusBtn.hidden = !document.fullscreenEnabled;
  focusBtn.setAttribute('aria-pressed', 'false');
  focusBtn.onclick = safe(() => document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen());
  document.addEventListener('fullscreenchange', () => {
    focusBtn.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    sizeMobileDialog();
  });
}

const posEl = $('#position');
if (posEl) {
  posEl.onclick = () => jumpPageDialog();
  posEl.tabIndex = 0;
  posEl.setAttribute('role', 'button');
  posEl.setAttribute('aria-label', 'Jump to page number or percentage');
  posEl.onkeydown = e => { if (e.key === 'Enter') posEl.click(); };
}

function updateReadingGestures(contents) {
  const action = prefs.flow === 'paginated' ? 'pinch-zoom' : 'pan-y pinch-zoom';
  contents.document.documentElement.style.touchAction = action;
  contents.document.body.style.touchAction = action;
}

function applyAppearance() {
  const [bg, fg] = (prefs.theme === 'custom' ? [prefs.customBg || '#f7f8f4', prefs.customFg || '#263d31'] : palettes[prefs.theme]) || palettes.paper;
  document.documentElement.style.setProperty('--bg', bg);
  document.documentElement.style.setProperty('--text', fg);
  document.documentElement.style.setProperty('--panel', bg);
  const dark = ['dark', 'oled'].includes(prefs.theme);
  document.documentElement.style.setProperty('--line', dark ? '#3a443c' : '#e5e8df');
  document.documentElement.style.setProperty('--muted', dark ? '#a9b7a8' : '#536154');
  document.documentElement.style.setProperty('--soft', dark ? '#344136' : '#eaf0e6');
  document.body.classList.toggle('dark', dark);
  const viewer = $('#viewer');
  if (viewer) viewer.style.maxWidth = prefs.width + 'px';
  const headingColor = dark ? (prefs.theme === 'oled' ? '#ffffff' : '#f0f5ee') : (prefs.theme === 'sepia' ? '#332314' : (prefs.theme === 'light' ? '#173e4d' : '#234433'));
  const linkColor = dark ? '#8dc58b' : (prefs.theme === 'sepia' ? '#8a5c2d' : '#2c6d48');
  const cardBg = dark ? (prefs.theme === 'oled' ? '#141414' : '#27312a') : (prefs.theme === 'sepia' ? '#ede2cb' : (prefs.theme === 'light' ? '#f4f7f8' : '#eef3eb'));
  const cardBorder = dark ? (prefs.theme === 'oled' ? '#333333' : '#3f4e43') : (prefs.theme === 'sepia' ? '#d8c7ad' : '#cdd8da');
  const noticeBg = dark ? (prefs.theme === 'oled' ? '#231e13' : '#2c271b') : (prefs.theme === 'sepia' ? '#faedd3' : '#fff6db');
  const noticeBorder = '#d49b29';

  rendition?.themes.default({
    html: {
      'background': bg + ' !important',
      'color': fg + ' !important'
    },
    body: {
      'background': bg + ' !important',
      'color': fg + ' !important',
      'font-family': prefs.font + ' !important',
      'font-size': prefs.size + 'px !important',
      'line-height': prefs.line + ' !important',
      'padding': prefs.margin + 'px !important',
      'font-weight': prefs.weight + ' !important',
      'letter-spacing': prefs.letter + 'px !important',
      'word-spacing': prefs.word + 'px !important',
      'text-align': prefs.align + ' !important'
    },
    'figure': {
      'margin-inline': '0 !important',
      'max-inline-size': '100%',
      'break-inside': 'avoid'
    },
    'img': {
      'max-inline-size': '100% !important',
      'object-fit': 'contain'
    },
    'figure img': {
      'block-size': 'auto !important'
    },
    '.verseindex a': {
      'display': 'inline-block',
      'min-inline-size': '2em',
      'margin-inline-end': '0.4em',
      'text-align': 'center'
    },
    'h1, h2, h3, h4, h5, h6, dt': {
      'color': headingColor + ' !important'
    },
    'p': {
      'line-height': prefs.line + ' !important',
      'margin-bottom': prefs.paragraph + 'em !important',
      'color': fg + ' !important'
    },
    'a': {
      'color': linkColor + ' !important'
    },
    '.card, .template, .intro-child, .simple-intro, .wordhelp, blockquote, pre': {
      'background': cardBg + ' !important',
      'color': fg + ' !important',
      'border-color': cardBorder + ' !important'
    },
    '.notice': {
      'background': noticeBg + ' !important',
      'color': fg + ' !important',
      'border-left-color': noticeBorder + ' !important'
    },
    '.meta, small, .pending, .eyebrow, figcaption': {
      'color': (dark ? '#a9b7a8' : (prefs.theme === 'sepia' ? '#705943' : '#556557')) + ' !important'
    },
    'table, th, td': {
      'color': fg + ' !important',
      'border-color': cardBorder + ' !important'
    },
    'hr': {
      'border-color': cardBorder + ' !important'
    }
  });
}

function appearance() {
  const d = dialog('Make yourself comfortable');
  d.className = '';
  const sw = el('div', undefined, 'swatches');
  Object.entries(palettes).forEach(([k, [bg, fg]]) => {
    const b = btn(k, () => {
      prefs.theme = k;
      applyAppearance();
      save();
    });
    b.style.background = bg;
    b.style.color = fg;
    sw.append(b);
  });
  d.append(sw);

  for (const [label, key, min, max, step] of [
    ['Font size', 'size', 12, 32, 1],
    ['Line spacing', 'line', 1.2, 2.4, 0.1],
    ['Reading width', 'width', 360, 1100, 20],
    ['Font weight', 'weight', 300, 700, 100],
    ['Letter spacing', 'letter', 0, 3, 0.1],
    ['Word spacing', 'word', 0, 8, 0.5],
    ['Paragraph spacing', 'paragraph', 0, 3, 0.1],
    ['Page margins', 'margin', 8, 70, 2]
  ]) {
    const i = el('input');
    i.type = 'range';
    i.min = min;
    i.max = max;
    i.step = step;
    i.value = prefs[key];
    field(d, label, i);
    i.oninput = () => {
      prefs[key] = +i.value;
      applyAppearance();
      save();
    };
  }

  const f = el('select');
  ['Georgia', 'Arial', 'Times New Roman', 'serif', 'sans-serif'].forEach(t => f.append(el('option', t)));
  f.value = prefs.font;
  f.onchange = () => { prefs.font = f.value; applyAppearance(); save(); };
  field(d, 'Typeface', f);

  const align = el('select');
  ['left', 'justify', 'center'].forEach(t => align.append(el('option', t)));
  align.value = prefs.align;
  align.onchange = () => { prefs.align = align.value; applyAppearance(); save(); };
  field(d, 'Text alignment', align);

  for (const [key, label, defaultColor] of [['customBg', 'Custom page color', '#f7f8f4'], ['customFg', 'Custom text color', '#263d31']]) {
    const input = el('input');
    input.type = 'color';
    input.value = prefs[key] || defaultColor;
    input.oninput = () => {
      prefs[key] = input.value;
      prefs.theme = 'custom';
      applyAppearance();
      save();
    };
    field(d, label, input);
  }

  const mode = el('select');
  for (const [v, t] of [['paginated', 'Pages'], ['scrolled-doc', 'Continuous scroll']]) {
    const o = el('option', t);
    o.value = v;
    mode.append(o);
  }
  mode.value = prefs.flow;
  mode.onchange = () => {
    prefs.flow = mode.value;
    rendition?.flow(prefs.flow);
    for (const contents of rendition?.getContents() || []) updateReadingGestures(contents);
    if (current?.cfi) rendition?.display(current.cfi);
    save();
  };
  field(d, 'Reading mode', mode);

  const spread = el('select');
  for (const [v, t] of [['none', 'Single page'], ['auto', 'Automatic two-page spread']]) {
    const o = el('option', t);
    o.value = v;
    spread.append(o);
  }
  spread.value = prefs.spread || 'none';
  spread.onchange = () => {
    prefs.spread = spread.value;
    rendition?.spread(prefs.spread);
    save();
  };
  field(d, 'Page layout', spread);
  d.append(el('p', 'Your preferences and reading position are saved automatically.', 'muted'));
}

const appearanceBtn = $('#appearance');
if (appearanceBtn) appearanceBtn.onclick = appearance;

const tocBtn = $('#toc');
if (tocBtn) {
  tocBtn.onclick = async () => {
    const d = dialog('Chapters & bookmarks');
    d.className = 'stack';
    const jump = btn('📄 Jump to page number…', jumpPageDialog);
    d.append(jump);
    const tocBook = book;
    if (!tocBook) return;
    const nav = await tocBook.loaded.navigation;
    if (book !== tocBook || !$('#dialog')?.open || !jump.isConnected) return;
    const listContainer = el('div', undefined, 'toc-list');
    const indexStatus = el('p', 'Preparing chapter page ranges…', 'muted');
    indexStatus.setAttribute('role', 'status');
    const entries = getFlatToc(nav?.toc);
    const rows = entries.map(item => {
      const itemBtn = el('button', undefined, 'chapter-item');
      const main = el('div', undefined, 'chapter-main');
      if (item.depth > 0) main.style.paddingLeft = (item.depth * 18) + 'px';
      const badge = el('span', '● Current', 'chapter-badge');
      badge.setAttribute('aria-label', 'Current chapter');
      main.append(el('span', item.label, 'chapter-label'), badge);
      const pages = el('span', undefined, 'chapter-pages');
      itemBtn.append(main, pages);
      itemBtn.onclick = () => {
        rendition?.display(item.href);
        $('#dialog')?.close();
      };
      listContainer.append(itemBtn);
      return { itemBtn, badge, pages };
    });
    function updateToc() {
      const ready = tocBook.leafLocationsReady && Boolean(tocBook.leafChapterPositions);
      indexStatus.hidden = ready || !entries.length;
      const chapters = ready ? getTocWithPages(tocBook, nav) : entries;
      const activeChapter = getActiveChapter(tocBook, nav, rendition?.currentLocation());
      chapters.forEach((item, i) => {
        const { itemBtn, badge, pages } = rows[i];
        const isCurrent = item.href === activeChapter?.href;
        itemBtn.classList.toggle('active', isCurrent);
        if (isCurrent) itemBtn.setAttribute('aria-current', 'true');
        else itemBtn.removeAttribute('aria-current');
        badge.hidden = !isCurrent;
        pages.textContent = item.pageRange || '';
        pages.hidden = !item.pageRange;
      });
    }
    listContainer.addEventListener('leaf:locations-ready', updateToc);
    updateToc();
    d.append(indexStatus, listContainer);
    d.append(el('h3', 'Your bookmarks'));
    const bms = annotations.filter(a => a.bookId === current.id && a.type === 'bookmark');
    if (!bms.length) {
      d.append(el('p', 'No bookmarks saved yet. Use the ♧ button while reading.', 'muted'));
    } else {
      bms.forEach(a => d.append(btn(a.text, () => {
        rendition?.display(a.cfi);
        $('#dialog')?.close();
      })));
    }
    setTimeout(() => {
      const activeEl = listContainer.querySelector('.chapter-item.active');
      activeEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 60);
  };
}

function paint(a) {
  try {
    rendition?.annotations.highlight(
      a.cfi,
      {},
      () => toast(a.note || a.text),
      'leaf-highlight',
      { 'fill': a.color || '#e2c86b', 'fill-opacity': '.35' }
    );
  } catch {}
}

async function addAnnotation(type) {
  if (!current) return;
  const cfi = type === 'bookmark' ? (selected?.cfi || current.cfi) : selected?.cfi;
  if (!cfi) return;

  if (type === 'note') {
    const textPassage = selected?.text || '';
    const d = dialog('Add note');
    d.className = 'stack';
    if (textPassage) {
      const q = el('blockquote', textPassage);
      q.style.fontStyle = 'italic';
      q.style.borderLeft = '3px solid var(--accent)';
      q.style.paddingLeft = '12px';
      q.style.margin = '0 0 12px';
      d.append(q);
    }
    const form = el('form');
    form.className = 'stack';
    form.append(el('label', 'Your reflection on this passage:'));
    const ta = el('textarea');
    ta.placeholder = 'Type your note here…';
    ta.required = true;
    form.append(ta);

    let chosenColor = '#e2c86b';
    const swatches = el('div', undefined, 'swatches');
    for (const color of ['#e2c86b', '#87bf83', '#7daed8', '#e49ab8', '#b49bd5', '#eab078']) {
      const b = btn('●', () => {
        chosenColor = color;
        swatches.querySelectorAll('button').forEach(x => x.style.transform = '');
        b.style.transform = 'scale(1.25)';
      });
      b.type = 'button';
      b.style.color = color;
      b.setAttribute('aria-label', 'Highlight color ' + color);
      swatches.append(b);
    }
    form.append(el('label', 'Highlight color:'), swatches);

    form.onsubmit = async e => {
      e.preventDefault();
      const note = ta.value.trim();
      const a = {
        id: uid(),
        bookId: current.id,
        cfi,
        text: textPassage || 'Note at ' + Math.round(current.progress || 0) + '%',
        type: 'note',
        note,
        created: Date.now(),
        color: chosenColor
      };
      annotations.push(a);
      paint(a);
      await save();
      $('#selection').hidden = true;
      $('#dialog')?.close();
      toast('Note saved');
    };
    const saveNote = btn('Save note', undefined, 'primary');
    saveNote.type = 'submit';
    form.append(saveNote);
    d.append(form);
    setTimeout(() => ta.focus(), 50);
    return;
  }

  if (type === 'bookmark' && annotations.some(a => a.type === 'bookmark' && a.bookId === current.id && a.cfi === cfi)) {
    toast('This location is already bookmarked.');
    return;
  }

  const a = {
    id: uid(),
    bookId: current.id,
    cfi,
    text: selected?.text || 'Bookmark at ' + Math.round(current.progress || 0) + '%',
    type,
    note: '',
    created: Date.now(),
    color: '#e2c86b'
  };
  annotations.push(a);
  if (type !== 'bookmark') paint(a);
  await save();
  $('#selection').hidden = true;
  toast(type === 'bookmark' ? 'Bookmark saved' : 'Passage saved');
}

const bookmarkBtn = $('#bookmark');
if (bookmarkBtn) bookmarkBtn.onclick = () => addAnnotation('bookmark');

// ==================== Text-to-Speech (TTS) Engine ====================
const ttsState = {
  playing: false,
  paused: false,
  chunks: [],
  chunkIndex: 0,
  voice: null,
  rate: 1,
  activeUtterance: null
};

function getTTSVoices() {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices() || [];
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    // Voices cache loaded
  };
}

function splitTextToChunks(text) {
  if (!text) return [];
  const raw = text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const matched = raw.match(/[^.!?\n]+[.!?\n]*/g);
  return matched ? matched.map(s => s.trim()).filter(Boolean) : [raw];
}

function stopTTS() {
  ttsState.playing = false;
  ttsState.paused = false;
  ttsState.chunks = [];
  ttsState.chunkIndex = 0;
  ttsState.activeUtterance = null;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function playNextTTSChunk(onUpdate) {
  if (!ttsState.playing || ttsState.paused) return;
  if (ttsState.chunkIndex >= ttsState.chunks.length) {
    stopTTS();
    onUpdate?.('Completed reading.');
    toast('Finished reading aloud.');
    return;
  }

  const sentence = ttsState.chunks[ttsState.chunkIndex];
  onUpdate?.(sentence, ttsState.chunkIndex, ttsState.chunks.length);

  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(sentence);
  ttsState.activeUtterance = u;
  if (ttsState.voice) u.voice = ttsState.voice;
  u.rate = ttsState.rate || 1;

  u.onend = () => {
    if (!ttsState.playing || ttsState.paused) return;
    ttsState.chunkIndex++;
    playNextTTSChunk(onUpdate);
  };

  u.onerror = e => {
    if (e.error === 'canceled' || e.error === 'interrupted') return;
    ttsState.chunkIndex++;
    playNextTTSChunk(onUpdate);
  };

  window.speechSynthesis.speak(u);
}

function openTTSDialog(initialText) {
  if (!('speechSynthesis' in window)) {
    toast('Text-to-Speech is not supported in this browser.');
    return;
  }

  const textToRead = initialText || getReaderVisibleText();
  if (!textToRead) {
    toast('No text available to read on this page.');
    return;
  }

  stopTTS();
  ttsState.chunks = splitTextToChunks(textToRead);
  ttsState.chunkIndex = 0;
  ttsState.playing = true;
  ttsState.paused = false;

  const d = dialog('Listen / Read aloud');
  d.className = 'tts-panel';

  const preview = el('div', ttsState.chunks[0] || 'Preparing audio…', 'tts-preview');
  const statusLine = el('p', `Sentence 1 of ${ttsState.chunks.length}`, 'muted');
  statusLine.style.fontSize = '12px';
  statusLine.style.textAlign = 'center';

  const controls = el('div', undefined, 'tts-controls');
  const prevBtn = btn('⏮', () => {
    if (ttsState.chunkIndex > 0) {
      ttsState.chunkIndex--;
      playNextTTSChunk(updateUI);
    }
  });
  prevBtn.setAttribute('aria-label', 'Previous sentence');

  const playPauseBtn = btn('⏸ Pause', () => {
    if (ttsState.paused) {
      ttsState.paused = false;
      ttsState.playing = true;
      playPauseBtn.textContent = '⏸ Pause';
      window.speechSynthesis.resume();
      if (!window.speechSynthesis.speaking) playNextTTSChunk(updateUI);
    } else {
      ttsState.paused = true;
      playPauseBtn.textContent = '▶ Play';
      window.speechSynthesis.pause();
    }
  }, 'primary');

  const nextBtn = btn('⏭', () => {
    if (ttsState.chunkIndex < ttsState.chunks.length - 1) {
      ttsState.chunkIndex++;
      playNextTTSChunk(updateUI);
    }
  });
  nextBtn.setAttribute('aria-label', 'Next sentence');

  const stopBtn = btn('⏹ Stop', () => {
    stopTTS();
    $('#dialog')?.close();
  });
  stopBtn.setAttribute('aria-label', 'Stop reading');

  controls.append(prevBtn, playPauseBtn, nextBtn, stopBtn);

  // Voice selector
  const voices = getTTSVoices();
  const voiceSelect = el('select');
  voiceSelect.setAttribute('aria-label', 'Reading voice');
  const isTamil = current?.language === 'ta' || /[\u0B80-\u0BFF]/.test(textToRead);

  let defaultVoice = null;
  voices.forEach(v => {
    const opt = el('option', `${v.name} (${v.lang})`);
    opt.value = v.name;
    voiceSelect.append(opt);
    if (!defaultVoice) {
      if (isTamil && v.lang.startsWith('ta')) defaultVoice = v;
      else if (!isTamil && v.lang.startsWith('en')) defaultVoice = v;
    }
  });

  if (defaultVoice) {
    voiceSelect.value = defaultVoice.name;
    ttsState.voice = defaultVoice;
  } else if (voices[0]) {
    ttsState.voice = voices[0];
  }

  voiceSelect.onchange = () => {
    ttsState.voice = voices.find(v => v.name === voiceSelect.value) || null;
    if (ttsState.playing && !ttsState.paused) playNextTTSChunk(updateUI);
  };

  const speedSelect = el('select');
  speedSelect.setAttribute('aria-label', 'Reading speed');
  for (const [val, label] of [[0.75, '0.75x (Slow)'], [1, '1.0x (Normal)'], [1.25, '1.25x'], [1.5, '1.5x (Fast)'], [2, '2.0x']]) {
    const opt = el('option', label);
    opt.value = String(val);
    speedSelect.append(opt);
  }
  speedSelect.value = String(ttsState.rate || 1);
  speedSelect.onchange = () => {
    ttsState.rate = parseFloat(speedSelect.value) || 1;
    if (ttsState.playing && !ttsState.paused) playNextTTSChunk(updateUI);
  };

  const settingsRow = el('div', undefined, 'stack');
  field(settingsRow, 'Voice:', voiceSelect);
  field(settingsRow, 'Speed:', speedSelect);

  d.append(preview, statusLine, controls, settingsRow);

  function updateUI(sentence, idx, total) {
    preview.textContent = sentence || '';
    if (idx !== undefined && total !== undefined) {
      statusLine.textContent = `Sentence ${idx + 1} of ${total}`;
    }
  }

  playNextTTSChunk(updateUI);
}

function getReaderVisibleText() {
  try {
    const contents = rendition?.getContents();
    if (contents && contents[0]?.document?.body) {
      const text = contents[0].document.body.innerText || contents[0].document.body.textContent;
      if (text?.trim()) return text.trim();
    }
  } catch {}
  return '';
}

const ttsTopBtn = $('#tts');
if (ttsTopBtn) ttsTopBtn.onclick = () => openTTSDialog(selected?.text || null);

// ==================== Dictionary & Translation ====================
function cleanWordForDictionary(text) {
  if (!text) return '';
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
}

async function translate() {
  const text = (selected?.text || '').trim();
  if (!text) return;
  const d = dialog('Translate a passage');
  d.className = 'stack';

  const preview = el('p', text);
  preview.style.fontStyle = 'italic';
  d.append(preview);

  const target = el('select');
  target.setAttribute('aria-label', 'Translate into language');
  for (const [k, v] of Object.entries(langs)) {
    const o = el('option', v);
    o.value = k;
    target.append(o);
  }
  const isTamilText = /[\u0B80-\u0BFF]/.test(text) || current?.language === 'ta';
  target.value = isTamilText ? 'en' : (prefs.target || 'ta');
  field(d, 'Translate into:', target);

  const transResultBox = el('div', undefined, 'trans-box');
  transResultBox.hidden = true;
  d.append(transResultBox);

  const actionRow = el('div', undefined, 'swatches');
  const translateBtn = btn('Translate now', safe(async () => {
    translateBtn.textContent = 'Translating…';
    translateBtn.disabled = true;
    try {
      const srcLang = isTamilText ? 'ta' : 'en';
      const tgtLang = target.value;
      const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${srcLang}|${tgtLang}`);
      if (!res.ok) throw new Error('Translation service unavailable. Please try again.');
      const json = await res.json();
      const translated = json?.responseData?.translatedText;
      if (!translated) throw new Error('Could not translate this passage.');

      transResultBox.hidden = false;
      transResultBox.replaceChildren();
      transResultBox.append(el('strong', `Translation (${langs[tgtLang] || tgtLang}):`), el('p', translated));

      const copyBtn = btn('Copy translation', async () => {
        await navigator.clipboard.writeText(translated);
        toast('Translation copied.');
      });
      const saveVocabBtn = btn('Save to vocabulary', async () => {
        vocabulary.push({
          id: uid(),
          word: text.slice(0, 50),
          definition: `[${langs[tgtLang]}]: ${translated}`,
          book: current?.title || 'Translation',
          created: Date.now()
        });
        await save();
        toast('Saved to vocabulary.');
      });
      transResultBox.append(el('div', undefined, 'swatches'));
      transResultBox.lastChild.append(copyBtn, saveVocabBtn);
      prefs.target = tgtLang;
      save();
    } catch (e) {
      transResultBox.hidden = false;
      transResultBox.replaceChildren(el('p', 'In-app translation error: ' + e.message, 'muted'));
    } finally {
      translateBtn.textContent = 'Translate now';
      translateBtn.disabled = false;
    }
  }), 'primary');

  const gTranslateBtn = btn('Open in Google Translate ↗', () => {
    prefs.target = target.value;
    save();
    window.open('https://translate.google.com/?sl=auto&tl=' + target.value + '&text=' + encodeURIComponent(text) + '&op=translate', '_blank', 'noopener,noreferrer');
  });

  actionRow.append(translateBtn, gTranslateBtn);
  d.append(actionRow);
}

async function dictionary() {
  const rawWord = (selected?.text || '').trim();
  const word = cleanWordForDictionary(rawWord);
  const d = dialog('Dictionary Lookup');
  d.className = 'stack';

  if (!word || word.split(/\s+/).length > 2) {
    d.append(
      el('h3', rawWord),
      el('p', 'Dictionary lookup works best for a single word. Would you like to translate this phrase instead?'),
      btn('Translate passage', () => { translate(); }, 'primary')
    );
    return;
  }

  d.append(el('h3', word));
  const defContainer = el('div', undefined, 'stack');
  d.append(defContainer);

  const lookupBtn = btn('Look up definition', safe(async () => {
    lookupBtn.textContent = 'Searching…';
    lookupBtn.disabled = true;
    try {
      const r = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word.toLowerCase()));
      if (!r.ok) {
        defContainer.replaceChildren(
          el('p', `No English definition found for "${word}".`, 'muted'),
          btn('Translate word instead', () => { translate(); }, 'primary')
        );
        return;
      }
      const data = await r.json();
      defContainer.replaceChildren();

      const entry = data[0];
      if (entry.phonetic || entry.phonetics?.length) {
        const phoneticBox = el('div', undefined, 'dict-phonetic');
        const phonText = entry.phonetic || entry.phonetics?.find(p => p.text)?.text || '';
        if (phonText) phoneticBox.append(el('span', phonText));
        const audioUrl = entry.phonetics?.find(p => p.audio)?.audio;
        if (audioUrl) {
          const playAudioBtn = btn('🔊 Listen', () => {
            const audio = new Audio(audioUrl);
            audio.play().catch(() => toast('Unable to play audio pronunciation.'));
          });
          phoneticBox.append(playAudioBtn);
        }
        defContainer.append(phoneticBox);
      }

      let primaryDefinition = '';
      if (entry.meanings?.length) {
        const list = el('div', undefined, 'dict-def-list');
        for (const m of entry.meanings.slice(0, 3)) {
          const item = el('div', undefined, 'dict-def-item');
          item.append(el('strong', m.partOfSpeech || 'definition'));
          const subList = el('ul');
          subList.style.margin = '4px 0 0 16px';
          subList.style.padding = '0';
          for (const d of (m.definitions || []).slice(0, 2)) {
            if (!primaryDefinition) primaryDefinition = d.definition;
            subList.append(el('li', d.definition));
          }
          item.append(subList);
          list.append(item);
        }
        defContainer.append(list);
      }

      defContainer.append(btn('Save to vocabulary', async () => {
        vocabulary.push({
          id: uid(),
          word,
          definition: primaryDefinition || 'Saved word',
          book: current?.title || 'Dictionary',
          created: Date.now()
        });
        await save();
        toast('Word saved to vocabulary.');
      }, 'primary'));
    } catch (e) {
      defContainer.replaceChildren(el('p', 'Dictionary network error: ' + e.message, 'muted'));
    } finally {
      lookupBtn.textContent = 'Look up definition';
      lookupBtn.disabled = false;
    }
  }), 'primary');

  d.append(lookupBtn);
  lookupBtn.click();
}

const selectionMore = $('#selection-more');
function setSelectionExpanded(expanded) {
  $('#selection').classList.toggle('expanded', expanded);
  selectionMore.setAttribute('aria-expanded', String(expanded));
  selectionMore.textContent = expanded ? 'Less' : 'More';
}
selectionMore.onclick = () => setSelectionExpanded(selectionMore.getAttribute('aria-expanded') !== 'true');

document.querySelectorAll('[data-selection]').forEach(b => b.onclick = safe(async () => {
  const action = b.dataset.selection;
  if (action === 'bookmark') await addAnnotation('bookmark');
  if (action === 'share') {
    if (navigator.share) {
      await navigator.share({ title: current?.title || 'Leaf Reader', text: selected.text });
    } else {
      await navigator.clipboard.writeText(selected.text);
      toast('Passage copied for sharing.');
    }
  }
  if (action === 'search') {
    const text = selected.text;
    $('#search-book')?.click();
    const searchInput = $('#dialog-body input');
    if (searchInput) searchInput.value = text;
  }
  if (action === 'copy') {
    await navigator.clipboard.writeText(selected.text);
    toast('Copied to clipboard.');
  }
  if (action === 'highlight') await addAnnotation('highlight');
  if (action === 'note') await addAnnotation('note');
  if (action === 'translate') translate();
  if (action === 'dictionary') dictionary();
  if (action === 'speak') openTTSDialog(selected.text);
}));

const searchBookBtn = $('#search-book');
if (searchBookBtn) {
  searchBookBtn.onclick = () => {
    const d = dialog('Search this book');
    d.className = '';
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Find a word or phrase';
    input.setAttribute('aria-label', 'Find a word or phrase');
    input.enterKeyHint = 'search';
    input.style.width = '100%';
    const results = el('div', undefined, 'stack');
    results.setAttribute('aria-live', 'polite');
    results.style.marginTop = '14px';
    const searchBook = book;
    if (!searchBook) return;
    const form = el('form', undefined, 'book-search-form');
    const submit = btn('Search', undefined, 'primary');
    submit.type = 'submit';
    let token = 0;
    form.onsubmit = safe(async e => {
      e.preventDefault();
      const term = input.value.trim();
      if (!term) return;
      const task = ++token;
      results.replaceChildren(el('p', 'Searching chapters…'));
      const active = () => task === token && book === searchBook && form.isConnected && $('#dialog')?.open;
      const matches = [];
      for (const section of searchBook.spine.spineItems) {
        if (!active()) return;
        await section.load(searchBook.load.bind(searchBook));
        if (book !== searchBook) return;
        matches.push(...section.find(term));
        section.unload();
        await new Promise(r => setTimeout(r, 0));
        if (matches.length >= 300) break;
      }
      if (!active()) return;
      results.replaceChildren(el('p', matches.length + ' matches' + (matches.length >= 300 ? ' (first 300 shown)' : '')));
      matches.slice(0, 300).forEach(m => results.append(btn(m.excerpt, () => {
        rendition?.display(m.cfi);
        $('#dialog')?.close();
      })));
    });
    form.append(input, submit);
    d.append(form, results);
    input.focus();
  };
}

function savedPage(c) {
  const isV = view === 'vocabulary';
  c.append(
    el('h1', isV ? 'Words worth keeping.' : 'Your thoughts, between the lines.'),
    el('p', isV ? 'Build a vocabulary from the books you love.' : 'Highlights, notes, and bookmarks from your reading.', 'subtitle')
  );

  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Search saved passages';
  search.setAttribute('aria-label', 'Search saved passages');
  search.oninput = () => {
    for (const card of c.querySelectorAll('.card')) {
      card.hidden = !card.textContent.toLowerCase().includes(search.value.toLowerCase());
    }
  };
  c.append(search);

  const items = isV ? vocabulary : annotations;
  if (!items.length) {
    c.append(el('div', isV ? 'Select a word while reading, then choose Dictionary or Translate.' : 'Select a passage to highlight it or add a note.', 'empty'));
  }

  for (const a of items) {
    const card = el('article', undefined, 'card');
    card.append(
      el('small', isV ? (a.book || 'Book') : (books.find(b => b.id === a.bookId)?.title || 'Book')),
      el('h3', isV ? a.word : (a.type ? a.type.toUpperCase() : 'ANNOTATION')),
      el('p', isV ? a.definition : a.text)
    );
    if (a.note) card.append(el('p', a.note));

    if (!isV) {
      const colors = el('div', undefined, 'swatches');
      if (a.type !== 'bookmark') {
        for (const color of ['#e2c86b', '#87bf83', '#7daed8', '#e49ab8', '#b49bd5', '#eab078']) {
          const b = btn('●', () => {
            a.color = color;
            save();
            render();
          });
          b.style.color = color;
          b.setAttribute('aria-label', 'Highlight color ' + color);
          colors.append(b);
        }
      }
      card.append(colors);
      card.append(
        btn('Go to passage', async () => {
          const b = books.find(b => b.id === a.bookId);
          if (b) {
            await openBook(b);
            rendition?.display(a.cfi);
          }
        }),
        btn('Edit note', () => {
          promptDialog('Edit note', 'Note:', a.note || '', note => {
            a.note = note;
            save();
            render();
          });
        })
      );
    }

    card.append(btn('Delete', () => {
      if (!confirm('Delete this ' + (isV ? 'word' : 'item') + '?')) return;
      if (isV) vocabulary = vocabulary.filter(x => x.id !== a.id);
      else annotations = annotations.filter(x => x.id !== a.id);
      save();
      render();
    }));
    c.append(card);
  }

  if (items.length) {
    c.append(btn('Export ' + (isV ? 'vocabulary' : 'annotations'), () => download(JSON.stringify(items, null, 2), 'leaf-' + view + '.json'), 'primary'));
  }
}

function calculateReadingStreak() {
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

function stats(c) {
  c.append(
    el('h1', 'A little reading adds up.'),
    el('p', 'Real reading time, measured only while reading is active.', 'subtitle')
  );

  const totalSeconds = sessions.reduce((s, x) => s + (x.seconds || 0), 0);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const streak = calculateReadingStreak();

  const row = el('div', undefined, 'stats');
  for (const [val, label] of [
    [String(books.filter(b => !b.demo).length), 'Your imported books'],
    [String(books.filter(b => b.completed).length), 'Books completed'],
    [`${totalHours}h`, `${totalMinutes} minutes read`],
    [`${streak} ${streak === 1 ? 'day' : 'days'}`, 'Current streak']
  ]) {
    const box = el('div', undefined, 'card');
    box.append(el('strong', val), el('span', label));
    row.append(box);
  }
  c.append(row);

  // Period Tabs: Daily, Weekly, Monthly
  const periodTabs = el('div', undefined, 'tabs');
  for (const [p, t] of [['daily', 'Daily (Last 14 days)'], ['weekly', 'Weekly (Last 8 weeks)'], ['monthly', 'Monthly (Last 6 months)']]) {
    periodTabs.append(btn(t, () => { statsPeriod = p; render(); }, statsPeriod === p ? 'active' : ''));
  }
  c.append(periodTabs);

  if (statsPeriod === 'daily') {
    c.append(el('h2', 'Daily reading history'));
    const grouped = {};
    sessions.forEach(s => { grouped[s.day] = (grouped[s.day] || 0) + (s.seconds || 0); });
    const sortedDays = Object.keys(grouped).sort().slice(-14);
    const maxSec = Math.max(1, ...Object.values(grouped));

    if (!sortedDays.length) {
      c.append(el('p', 'Open a book to begin tracking your reading journey.', 'muted'));
    } else {
      for (const day of sortedDays) {
        const sec = grouped[day];
        const r = el('div', undefined, 'card');
        const min = Math.floor(sec / 60);
        r.append(el('div', undefined, 'chart-bar-row'));
        r.firstChild.append(
          el('span', day),
          (() => {
            const pr = el('progress');
            pr.max = maxSec;
            pr.value = sec;
            return pr;
          })(),
          el('strong', `${min}m`)
        );
        c.append(r);
      }
    }
  } else if (statsPeriod === 'weekly') {
    c.append(el('h2', 'Weekly reading summary'));
    const weekly = {};
    sessions.forEach(s => {
      const d = new Date(s.day + 'T00:00:00');
      const startOfWeek = new Date(d);
      startOfWeek.setDate(d.getDate() - d.getDay());
      const key = startOfWeek.toLocaleDateString('en-CA');
      weekly[key] = (weekly[key] || 0) + (s.seconds || 0);
    });
    const sortedWeeks = Object.keys(weekly).sort().slice(-8);
    const maxSec = Math.max(1, ...Object.values(weekly));

    if (!sortedWeeks.length) {
      c.append(el('p', 'No weekly sessions recorded yet.', 'muted'));
    } else {
      for (const week of sortedWeeks) {
        const sec = weekly[week];
        const hours = (sec / 3600).toFixed(1);
        const r = el('div', undefined, 'card');
        r.append(el('div', undefined, 'chart-bar-row'));
        r.firstChild.append(
          el('span', `Week of ${week}`),
          (() => {
            const pr = el('progress');
            pr.max = maxSec;
            pr.value = sec;
            return pr;
          })(),
          el('strong', `${hours}h`)
        );
        c.append(r);
      }
    }
  } else {
    c.append(el('h2', 'Monthly reading summary'));
    const monthly = {};
    sessions.forEach(s => {
      const key = s.day.slice(0, 7); // YYYY-MM
      monthly[key] = (monthly[key] || 0) + (s.seconds || 0);
    });
    const sortedMonths = Object.keys(monthly).sort().slice(-6);
    const maxSec = Math.max(1, ...Object.values(monthly));

    if (!sortedMonths.length) {
      c.append(el('p', 'No monthly sessions recorded yet.', 'muted'));
    } else {
      for (const month of sortedMonths) {
        const sec = monthly[month];
        const hours = (sec / 3600).toFixed(1);
        const r = el('div', undefined, 'card');
        r.append(el('div', undefined, 'chart-bar-row'));
        r.firstChild.append(
          el('span', month),
          (() => {
            const pr = el('progress');
            pr.max = maxSec;
            pr.value = sec;
            return pr;
          })(),
          el('strong', `${hours}h`)
        );
        c.append(r);
      }
    }
  }

  // Book breakdown
  const activeBooks = books.filter(b => sessions.some(s => s.bookId === b.id));
  if (activeBooks.length) {
    c.append(el('h2', 'Reading time per book'));
    for (const b of activeBooks) {
      const bSec = sessions.filter(s => s.bookId === b.id).reduce((s, x) => s + (x.seconds || 0), 0);
      const bMin = Math.floor(bSec / 60);
      const card = el('div', undefined, 'card');
      card.append(
        el('h3', b.title),
        el('p', `${bMin} minutes total · ${Math.round(b.progress || 0)}% read ${b.completed ? '· Completed' : ''}`, 'muted')
      );
      c.append(card);
    }
  }
}

function restorePreferences(prefs, restored = {}) {
  if (!restored || typeof restored !== 'object') return;
  const ranges = {
    size: [12, 32],
    line: [1.2, 2.4],
    width: [360, 1100],
    weight: [300, 700],
    letter: [0, 3],
    word: [0, 8],
    paragraph: [0, 3],
    margin: [8, 70]
  };
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = restored[key];
    if (typeof value === 'number' && Number.isFinite(value)) prefs[key] = Math.max(min, Math.min(max, value));
  }
  const allowed = {
    font: ['Georgia', 'Arial', 'Times New Roman', 'serif', 'sans-serif'],
    target: Object.keys(langs),
    spread: ['none', 'auto'],
    align: ['left', 'justify', 'center'],
    theme: [...Object.keys(palettes), 'custom'],
    flow: ['paginated', 'scrolled-doc']
  };
  for (const [key, values] of Object.entries(allowed)) {
    if (values.includes(restored[key])) prefs[key] = restored[key];
  }
  for (const key of ['customBg', 'customFg']) {
    if (typeof restored[key] === 'string' && /^#[0-9a-f]{6}$/i.test(restored[key])) prefs[key] = restored[key];
  }
}

function settingsPage(c) {
  c.append(
    el('h1', 'A reader that feels like you.'),
    el('p', 'Simple defaults. Room to make it your own.', 'subtitle')
  );

  const box = el('div', undefined, 'card');
  box.append(
    el('h2', 'Reading preferences'),
    el('p', 'Choose your typeface, page color, and reading rhythm.'),
    btn('Customize appearance', appearance, 'primary')
  );
  c.append(box);

  const backup = el('div', undefined, 'card');
  backup.append(
    el('h2', 'Your library, safely backed up'),
    el('p', 'Export a ZIP with EPUB files, reading positions, notes, vocabulary, and settings. Keep a copy before clearing browser data.'),
    btn('Export full backup', safe(async () => {
      toast('Preparing backup…');
      const z = new JSZip();
      z.file('leaf.json', JSON.stringify({ version: 1, books, annotations, vocabulary, sessions, prefs }));
      for (const b of books.filter(b => !b.demo)) {
        const data = await get(b.id);
        if (data) z.file('books/' + b.id + '.epub', data);
      }
      const blob = await z.generateAsync({ type: 'blob' });
      download(blob, 'leaf-backup.zip', 'application/zip');
      toast('Backup ready');
    }), 'primary')
  );

  const file = el('input');
  file.type = 'file';
  file.accept = '.zip';
  file.hidden = true;
  file.onchange = safe(async () => {
    const rawFile = file.files[0];
    if (!rawFile) return;
    const z = await JSZip.loadAsync(rawFile);

    // ZIP bomb protection
    const unpacked = Object.values(z.files).reduce((n, f) => n + (f._data?.uncompressedSize || 0), 0);
    if (unpacked > 350 * 1024 * 1024 || Object.keys(z.files).length > 15000) {
      throw Error('This backup exceeds safe archive limits.');
    }

    // ZIP slip path traversal protection
    for (const name of Object.keys(z.files)) {
      if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) {
        throw Error('Backup contains unsafe file paths.');
      }
    }

    const entry = z.file('leaf.json');
    if (!entry) throw Error('This is not a Leaf backup.');
    const data = JSON.parse(await entry.async('string'));
    if (data.version !== 1 || !Array.isArray(data.books) || !Array.isArray(data.annotations) || !Array.isArray(data.vocabulary) || !Array.isArray(data.sessions)) {
      throw Error('Invalid backup structure.');
    }

    for (const b of data.books) {
      if (typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(b.id) || typeof b.title !== 'string' || typeof b.author !== 'string' || !Number.isFinite(b.added)) {
        throw Error('Invalid book data.');
      }
      if (b.cover && typeof b.cover === 'string' && !/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(b.cover)) {
        b.cover = null;
      }
      if (b.demo && !demos.some(x => x.id === b.id && x.path === b.path)) throw Error('Unknown sample book.');
      if (!b.demo && !z.file('books/' + b.id + '.epub')) throw Error('Backup is missing a book.');
    }
    for (const a of data.annotations) {
      if (typeof a.id !== 'string' || typeof a.cfi !== 'string' || typeof a.text !== 'string') throw Error('Invalid annotation.');
    }
    if (!confirm('Merge this backup into your library? Existing records will be kept.')) return;

    const idMap=new Map();
for(const b of data.books){
 const existing=books.find(x=>x.id===b.id||(b.hash&&x.hash===b.hash));
 if(existing){idMap.set(b.id,existing.id);continue}
 if(!b.demo)await put(b.id,await z.file('books/'+b.id+'.epub').async('arraybuffer'));
 books.push(b);idMap.set(b.id,b.id);
}
for(const a of data.annotations){
 const bookId=idMap.get(a.bookId)||a.bookId;
 if(books.some(b=>b.id===bookId)&&!annotations.some(x=>x.id===a.id))annotations.push({...a,bookId});
}
for(const v of data.vocabulary)if(!vocabulary.some(x=>x.id===v.id))vocabulary.push(v);
for(const session of data.sessions){
 const bookId=idMap.get(session.bookId)||session.bookId;
 if(books.some(b=>b.id===bookId)&&!sessions.some(x=>x.id===session.id))sessions.push({...session,bookId});
}
restorePreferences(prefs,data.prefs);
await save();applyAppearance();render();toast('Backup restored')
  });

  backup.append(btn('Restore backup', () => file.click()), file);
  c.append(backup);

  const local = el('div', undefined, 'card');
  local.append(
    el('h2', 'Private by design'),
    el('p', 'Books and annotations stay in this browser. Translation and dictionary requests require an explicit click. Offline reading works after the app and books have loaded.'),
    btn('Request persistent storage', safe(async () => toast(await navigator.storage?.persist?.() ? 'Persistent storage enabled.' : 'Your browser manages storage automatically. Keep regular backups.')))
  );
  c.append(local);
}

function keys(e) {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || $('#dialog')?.open) return;
  if (!current) return;
  if (e.key === 'ArrowRight' || (e.key === ' ' && !e.shiftKey) || e.key === 'PageDown') {
    e.preventDefault();
    rendition?.next();
  }
  if (e.key === 'ArrowLeft' || (e.key === ' ' && e.shiftKey) || e.key === 'PageUp') {
    e.preventDefault();
    rendition?.prev();
  }
  if (e.key === 'Escape') {
    $('#selection').hidden = true;
  }
  if (e.key.toLowerCase() === 't') $('#toc')?.click();
  if (e.key.toLowerCase() === 's') { $('#search-book')?.click(); e.preventDefault(); }
  if (e.key.toLowerCase() === 'b') $('#bookmark')?.click();
  if (e.key.toLowerCase() === 'f') $('#focus')?.click();
  if (e.key.toLowerCase() === 'g') { e.preventDefault(); jumpPageDialog(); }
  if (e.key.toLowerCase() === 'l') { e.preventDefault(); openTTSDialog(selected?.text || null); }
  activity = Date.now();
}

document.addEventListener('keydown', keys);
document.addEventListener('pointerdown', () => { activity = Date.now(); });

setInterval(() => {
  if (!current || document.hidden || Date.now() - activity > 120000) return;
  const day = new Date().toLocaleDateString('en-CA');
  let s = sessions.find(s => s.day === day && s.bookId === current.id);
  if (!s) {
    s = { id: uid(), day, bookId: current.id, seconds: 0 };
    sessions.push(s);
  }
  s.seconds += 15;
  save();
}, 15000);

try {
  const data = await get('meta');
  if (data) {
    books = data.books || [];
    annotations = data.annotations || [];
    vocabulary = data.vocabulary || [];
    sessions = data.sessions || [];
    prefs = { ...prefs, ...data.prefs };
    for (const d of demos) {
      if (!books.some(b => b.id === d.id) && !localStorage.getItem('removed_' + d.id)) {
        books.push({ ...d });
      }
    }
  } else {
    books = demos;
    if (matchMedia('(prefers-color-scheme: dark)').matches) prefs.theme = 'dark';
    await save();
  }
  applyAppearance();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => toast('Offline setup failed. Reading is still available online.'));
  }
} catch (e) {
  $('#content')?.append(
    el('h1', 'Storage is unavailable.'),
    el('p', 'Allow browser storage and reload to keep your books safely on this device.')
  );
}
