# Leaf Reader

A buildless, static EPUB reader using native JavaScript modules, epub.js 0.3.93, JSZip 3.10.1, IndexedDB, and a Service Worker. No server, login, tracking, or frontend API keys are required by the app. GitHub Pages serves the app publicly after Pages is enabled.

## Run locally

From ``, run `python3 -m http.server 8000` and open http://localhost:8000. HTTPS or localhost is required for service workers and clipboard features. All runtime dependencies are vendored; there is no build step.

## Available features

- Multi-file EPUB import and drag/drop, SHA-256 duplicate detection, metadata and cover extraction, device-local persistence.
- Responsive grid/list library, search, sorting, favorites, completed state, collection labels, and editable display titles.
- EPUB rendering, TOC, single/double-page layout, paginated/scroll modes, saved CFI positions, percentage jumps, keyboard navigation and conservative swipe navigation.
- Five preset themes and custom colors; typeface, size, weight, line/word/letter/paragraph spacing, margins, width and alignment controls.
- Native text selection, six highlight colors, notes, bookmarks, saved-passage search, CFI navigation, export, copy and share.
- Explicit-consent external Google Translate links, defaulting to Tamil. English dictionary lookup using dictionaryapi.dev, with saved vocabulary.
- Selected-passage speech synthesis with pause/resume/stop, where the browser supports it.
- Real activity-based reading time, daily totals, imported/completed book counts. Timers pause when hidden or after two minutes without interaction.
- Full ZIP backups include imported EPUBs, metadata, annotations, vocabulary, settings and reading sessions. Restore validates the manifest and merges by IDs / content hashes.
- Offline shell, vendored dependencies and previously opened sample EPUBs. Imported books and annotations live in IndexedDB.

## Architecture

`js/app.js` owns presentation, EPUB lifecycle and feature orchestration. `js/storage.js` wraps IndexedDB. `css/style.css` contains responsive layout and theme rules. `sw.js` caches same-origin app resources. `samples/` contains readable EPUB examples. UI strings from books and backups are inserted using textContent rather than HTML.

The implementation consolidates the proposed module tree rather than creating empty placeholder modules. Each feature is a named function; further separation is appropriate as the project grows.

## Privacy and security

EPUB scripts are disabled through epub.js iframe sandbox configuration. A pre-render content hook removes active elements, inline event handlers, dangerous URL schemes and direct remote resource attributes. This is defense in depth, not a completed security audit of the EPUB engine. An EPUB-document Content Security Policy restricts resources to inline/blob/data sources and blocks connections, scripts and forms. Imports are capped at 100 MB compressed, 350 MB declared uncompressed content and 15,000 archive entries. A dedicated hostile-file security audit is still required.

The app does not transmit imported books to a server. Google Translate receives only the selected passage after an explicit click. dictionaryapi.dev receives the chosen word after an explicit click. Browser speech voices may depend on the platform/network. Never add private provider credentials to static JavaScript.

## Offline and compatibility limits

Use a current browser with IndexedDB, ES modules and iframe support. Private browsing, quota eviction and browser data clearing may remove local books; keep a ZIP backup. Sample books are cached as opened. External translation/dictionary functions require connectivity. Fixed-layout EPUBs are delegated to epub.js and are not verified across devices; DRM-encrypted books are not supported. Browser-native selection handles vary by platform.

## Scope and remaining work

This is a functional first release, not completion of every item in the supplied advanced specification. Not yet included: built-in translation provider and translation history, advanced dictionary fields, reading-time estimates, paragraph/chapter speech with voice/speed/pitch controls, focus ruler/paragraph tools, dedicated mobile bottom navigation, automatic toolbar hiding, search match overlays and worker indexes, chapter-level note filters, location back stack, expanded streak/weekly/monthly analytics, and the requested fully split feature-module tree. Comprehensive WCAG 2.2 AA certification, hostile EPUB security review and cross-device regression testing remain outstanding.

## Sample books

The Secret Garden (17396), Walden (205), Pride and Prejudice (1342), Alice's Adventures in Wonderland (11), and Siddhartha (2500) are bundled from Project Gutenberg EPUB editions. Their embedded license notices remain intact. Check the copyright rules applicable to your jurisdiction. The Art of Slowing Down is an original two-chapter demonstration generated for this app. Sample books are labeled and no invented reading statistics are seeded.

## Validation

JavaScript syntax and sample EPUB archive structure checked. Browser QA confirms the library, EPUB rendering and navigation. See VALIDATION.md for the precise verified scope and outstanding checks.
 
## GitHub Pages

In repository Settings → Pages, select **GitHub Actions** as the source. Then open Actions → Deploy Leaf Reader → Run workflow. The workflow publishes the repository's static app files.

Expected URL after successful deployment: https://vaikundamani-l.github.io/leaf-reader/
