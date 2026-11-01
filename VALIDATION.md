# Validation

- Passed: native JavaScript module syntax checks.
- Passed: sample EPUB zip integrity, mimetype and package/container presence.
- Passed in cloud Chrome: library render, stored sample metadata, reading sample opens, next-chapter navigation, return to saved book after preview reload, creation and listing of bookmarks, full-book search (two matching occurrences in the original sample).
- Responsive CSS includes 320–700 px, tablet, desktop and wide-screen layouts; real touch-device testing is outstanding.
- Outstanding end-to-end checks: import through native file picker, long-press touch selection, highlight persistence across all EPUB variants, offline network-disabled session, backup export/restore round trip, accessibility audit and fixed-layout EPUB behavior.

## Navigation repair — 2026-11-01

The reader previously removed EPUB base URLs during sanitization, then classified
links by the browser-resolved `anchor.href`. In a srcdoc frame, a fragment such
as `#P05` therefore became a link to the reader website. epub.js also attempted
to interpret a bare fragment as a spine ID. The new capture handler resolves the
original EPUB attribute against its source archive section and uses the reader's
navigation API once. The sanitizer and iframe restrictions remain enabled.

Verified with the Tamil legal guide in an epub.js 0.3.93 sandboxed srcdoc reader:

- All 1,717 internal content links activated through the reader handler.
- All 110 table-of-contents destinations opened.
- All 482 rendered reading pages traversed through the final page at the test
  viewport. This is a rendering/navigation check, not a legal content review.
- Zero external-link confirmations, new-window callbacks or navigation errors.
- Cover image and Tamil font loaded.
- Local Leaf Reader: contents topic opened lesson P05; reopening restored
  p. 116/564 and 20%, without doubling the saved location count.
- Dark page background and foreground match the selected theme.
- `node navigation-regression.mjs` passes archive-relative and root paths,
  fragments, external confirmation, unsafe schemes, malformed URLs, missing
  anchors and duplicate saved-location rejection.
- `node regression.cjs` continues to pass backup remapping, preferences,
  cancellation during open, online cache refresh and offline fallback.

Page counts vary with viewport and typography. A 564-item location index is
separate from the 482 rendered reading pages at the integration test viewport.
