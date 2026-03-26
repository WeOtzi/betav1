# HEIC Image Format Compatibility

**Date:** 2026-03-24
**Status:** Approved
**Scope:** All image upload points in weotzi-unified

---

## Problem

iPhones capture photos in HEIC/HEIF format by default. Most browsers (Chrome, Firefox, Edge) cannot display or process HEIC files natively, causing silent failures or blank previews when artists and clients try to upload photos from iOS devices.

---

## Solution Overview

Client-side HEIC detection, conversion to JPEG, and compression using two CDN libraries:

- **`heic2any`** — converts HEIC/HEIF blobs to JPEG in the browser
- **`browser-image-compression`** — compresses images using a Web Worker (no UI blocking)

All processing happens on the device. Zero server changes required.

---

## Architecture

### Shared Utility: `public/shared/js/heic-converter.js`

A single shared module exposing three exports:

#### `convertIfHEIC(file: File) → Promise<File>`

- Detects HEIC by file extension (`.heic`, `.heif`) OR `file.type` (`image/heic`, `image/heif`)
- On iOS, `file.type` may be empty — extension check is primary
- Converts using `heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })`
- Returns new `File` object with `.jpg` extension and `image/jpeg` MIME type
- If conversion fails or file is not HEIC, returns original file unchanged (this is an **expected path**, not an error — iOS Safari may deliver HEIC files already transcoded by the OS)

#### `compressImage(file: File) → Promise<File>`

- Uses `browser-image-compression` with `useWebWorker: true`
- Settings: `maxSizeMB: 1`, `maxWidthOrHeight: 2000`, quality `0.85`
- Runs off main thread — no UI freeze on mobile
- Returns compressed `File` object

#### `UploadQueue` class

Used **only** for upload points where the file selection and the Supabase upload happen in the same action (artist avatar and gallery). Not applicable to multi-step forms.

```
class UploadQueue {
  constructor(uploadFn, onProgress, onError)
  addFiles(files[])
  _processNext()
}
```

**Sequential pipeline per file:**
1. `convertIfHEIC(file)` → JPEG if HEIC
2. `compressImage(file)` → compressed JPEG
3. `uploadFn(file)` → upload to Supabase
4. `onProgress(current, total)` → called before upload starts (so user sees `1/3 subiendo...`)
5. Proceed to next file

**Error handling:** per-file isolation — one failure does not stop the queue. Error reported via `onError(file, error)`.

---

## Integration Points

### 1. Artist Dashboard — Avatar (`dashboard.js` → `handleAvatarUpload`)
- Single file, upload is immediate on selection
- Use `UploadQueue` (single-item queue)
- Relax pre-conversion type guard: replace `file.type.startsWith('image/')` check with one that also permits `image/heic`, `image/heif`, and empty type (HEIC on some browsers has no type)
- Update `<input accept>` to include `image/heic,image/heif`

### 2. Artist Dashboard — Gallery (`dashboard.js` → `handleGalleryUpload`, `handleGalleryEditUpload`)
- Multi-file upload (up to 12 images), upload is immediate on selection
- Use `UploadQueue` — processes each image sequentially
- UI shows `1/N`, `2/N`... progress during queue
- Same type guard relaxation as avatar
- Update `<input accept>` to include `image/heic,image/heif`

### 3. Quotation Reference Images (`script.js` → `handleFiles`)
- **Upload is deferred** — user selects files at step N, actual Supabase upload happens at form submission inside `uploadReferencesToStorage()`
- Do **NOT** use `UploadQueue` here
- Call `convertIfHEIC` + `compressImage` sequentially inside `handleFiles` before adding to `uploadedFiles[]`
- Preview rendering (`renderPreviews`) runs after conversion — previews are JPEG blobs, not raw HEIC
- The existing upload loop in `uploadReferencesToStorage` is unchanged

### 4. Job Board Request (`job-board-request.js` → `addFiles()`)
- **Upload is deferred** — `handleFileSelect` and `handleDrop` both delegate to `addFiles()`, which stores files for submission later
- Do **NOT** use `UploadQueue` here
- Call `convertIfHEIC` + `compressImage` inside `addFiles()` before validation and before pushing to `uploadedFiles[]`
- Update `ACCEPTED_IMAGE_TYPES` to include `'image/heic'` and `'image/heif'` (needed before conversion runs)
- Update the `accept` attribute string inside `renderColorRefs()` to include `image/heic,image/heif`

---

## Script Loading

CDN libraries are loaded as **synchronous `<script>` tags in `<head>`**, consistent with how Supabase, EmailJS, and Flatpickr are loaded in this project. Do NOT use `defer` — the project's application scripts load synchronously from the bottom of `<body>` and assume dependencies are already available.

```html
<!-- In <head>, before application scripts -->
<script src="https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js"></script>
```

`heic-converter.js` is loaded **after** the CDN libraries and **before** the feature scripts that use it (dashboard.js, script.js, job-board-request.js).

**Pages:**
- `public/artist/dashboard/index.html`
- `public/quotation/index.html`
- `public/job-board/request/index.html` ← request wizard page, NOT `/job-board/index.html` (feed)

---

## Compatibility

| Browser / Platform | HEIC Detection | Conversion | Notes |
|---|---|---|---|
| iOS Safari | Extension check | Skipped (OS may transcode already) | `convertIfHEIC` returns original file gracefully if heic2any input is not HEIC |
| Chrome iOS | Extension check | heic2any | No native HEIC support |
| Chrome Android | Extension check | heic2any | No native HEIC support |
| Chrome Desktop | Extension check | heic2any | No native HEIC support |
| Firefox Desktop | Extension check | heic2any | No native HEIC support |
| Edge Desktop | Extension check | heic2any | No native HEIC support |
| Safari Desktop (macOS) | Extension check | heic2any | No native HEIC support |

**iOS Safari note:** iOS 11+ can display HEIC natively and may transcode to JPEG on export depending on system settings. `heic2any` throwing on already-transcoded input is handled by the catch-and-return-original path in `convertIfHEIC`. This is expected behavior, not an error.

---

## File Changes Summary

| File | Action |
|---|---|
| `public/shared/js/heic-converter.js` | **CREATE** — shared utility (convertIfHEIC, compressImage, UploadQueue) |
| `public/shared/js/dashboard.js` | **MODIFY** — use UploadQueue in avatar + gallery handlers; relax type guards; conversion before upload |
| `public/shared/js/script.js` | **MODIFY** — convert + compress inside handleFiles before adding to uploadedFiles[] |
| `public/shared/js/job-board-request.js` | **MODIFY** — convert + compress inside addFiles(); update ACCEPTED_IMAGE_TYPES; update accept string in renderColorRefs() |
| `public/artist/dashboard/index.html` | **MODIFY** — add CDN script tags in head; update input accept attributes |
| `public/quotation/index.html` | **MODIFY** — add CDN script tags in head |
| `public/job-board/request/index.html` | **MODIFY** — add CDN script tags in head; update input accept attribute |

---

## Non-Goals

- No server-side changes
- No build step or bundler required
- No format support beyond HEIC/HEIF (RAW, TIFF, etc. out of scope)
