# Leaf Reader

A buildless, high-performance, distraction-free EPUB reader web application built with native JavaScript modules, EPUB.js, JSZip, IndexedDB, and Service Worker. Runs 100% locally on your device with no backend servers, no user accounts, and zero tracking.

Live Demo: https://vaikundamani-l.github.io/leaf-reader/

## Features

### 📖 Reading Experience
- **Multi-file EPUB Import**: Drag and drop or file picker import with SHA-256 duplicate detection, zip-slip/zip-bomb protection, and cover extraction.
- **Fast Large Book Engine**: Optimized location caching enables large EPUBs to open in under 1 second.
- **Fluid Navigation**: Next/Previous buttons, keyboard shortcuts (`ArrowLeft`/`ArrowRight`, `PageUp`/`PageDown`, `Space`, `g` jump), and mobile swipe gestures.
- **Table of Contents & Bookmarks**: Dynamic TOC with active chapter highlighting, page number ranges, and instant jump.
- **Custom Appearance**: Paper, Light, Sepia, Dark, OLED, and Custom themes with font family, font size, weight, line height, letter spacing, paragraph margins, and alignment controls. Single-page and two-page spread layouts.

### 📝 Highlights, Notes & Vocabulary
- **Passage Highlights**: 6 soothing pastel highlight colors with persistence across chapter reloads.
- **Reflective Notes**: In-app accessible modal for taking and editing notes attached to passages.
- **Vocabulary Builder**: Saved dictionary definitions and translations accessible directly from the sidebar.

### 🗣️ Text-to-Speech (TTS)
- **Voice Selection**: Automatically detects book language and suggests matching voices (including Tamil `ta-IN` and English voices).
- **Speed Controls**: Adjustable speech rate (0.75x, 1.0x, 1.25x, 1.5x, 2.0x).
- **Sentence Chunking**: Sentence-by-sentence reading with sentence preview, previous/next sentence buttons, play/pause, and stop controls. Prevents browser speech freeze bugs.
- **Read Aloud**: Accessible from reader top bar (`🔊`) or selected text popup.

### 🌐 Dictionary & Translation
- **Dictionary Lookup**: Automatic punctuation stripping and clean word definition lookups via dictionaryapi.dev with phonetics and audio pronunciations.
- **In-App Translation**: Instant translation between English, Tamil, and 10 other languages via MyMemory API, with direct fallback to Google Translate.

### 📊 Reading Insights & Analytics
- **Summary Metrics**: Total hours read, books completed, imported book count, and current daily reading streak.
- **Multi-Period Reports**: Daily report (last 14 days), Weekly summary (last 8 weeks), and Monthly overview (last 6 months).
- **Book Breakdown**: Reading time and percentage read per book.

### 🔒 Security & Privacy First
- **Content Security Policy (CSP)**: Strict resource isolation preventing unauthorized script execution or data exfiltration.
- **EPUB Content Sandbox**: Iframes strip active scripts, event handlers (`on*`), and dangerous URL schemes (`javascript:`, `data:`).
- **ZIP Slip & Bomb Protection**: Archive limits and path traversal checks prevent malicious files from escaping boundaries or exhausting system memory.
- **Local-First**: All books, notes, and metrics remain in device IndexedDB.

### 💾 Backup & Restore
- Full export and restore of library EPUBs, reading locations, highlights, notes, vocabulary, and preferences in a single `.zip` file with integrity checks and duplicate resolution.

### 📱 Responsive & Accessible (WCAG 2.2 AA)
- Responsive layout adapting seamlessly from mobile (320px–480px) with bottom thumb navigation to tablets and wide desktop screens.
- WCAG 2.2 AA compliant contrast ratios across all default themes.
- Full keyboard navigation and ARIA landmarks/roles.

## Running Locally

From the project root:
```bash
python3 -m http.server 8080
```
Open http://127.0.0.1:8080 in your browser. (HTTPS or localhost is required for Service Worker and clipboard features).

## Testing

Leaf Reader comes with an automated test suite covering regression checks, security audits, EPUB integrity, and Chrome headless end-to-end automation:

```bash
# Run all tests
npm test

# Run individual test suites
npm run test:regression  # Backup ID remapping, preferences, SW offline fallback
npm run test:unit        # Security, CSP, Manifest, TTS chunker, word cleaner, streak
npm run test:epub        # EPUB container, OPF, and Tamil text integrity
npm run test:e2e         # Headless Chrome CDP browser automation
npm run test:large       # Large EPUB loading and navigation performance
```

## Deployment on GitHub Pages

1. In your GitHub repository: go to **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, select **GitHub Actions**.
3. Push to `main` branch. The `.github/workflows/pages.yml` workflow automatically runs quality tests and deploys the static site to GitHub Pages.

Live URL: `https://vaikundamani-l.github.io/leaf-reader/`
