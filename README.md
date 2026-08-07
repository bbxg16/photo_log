# Photo Log Editor

A lightweight browser-based editor for making simple photo logs from multiple images.

Photo Log Editor is designed for people who want to upload a few images, optionally add text to some of them, reorder everything, and export one long stitched image for sharing on Weibo, WeChat Moments/Friends Circle, or other social platforms.

## What It Does

- Upload up to 9 photos in one session.
- View uploaded photos in a 3 x 3 gallery.
- Select only the photos that need text edits.
- Add one or more editable text boxes directly on an image.
- Adjust text size, text color, and text background.
- Drag text boxes into place.
- Reorder all uploaded photos before stitching.
- Export one long vertical stitched image.

## Simple Workflow

1. Upload photos.
2. Select the photos that need text.
3. Edit text directly on the image.
4. Continue to Stitch.
5. Reorder the uploaded photos.
6. Download the final long image.

Photos that do not need text can skip editing and still be included in the stitched result.

## Privacy

This app is completely client-side:

- No backend.
- No login.
- No cloud storage.
- No permanent saving.

Photos stay on the user's device during the current browser session.

## Supported Formats

- JPG / JPEG
- PNG
- WebP
- HEIC / HEIF when browser-side conversion works

For iPhone Live Photos, the app only works with the still image.

## Image Quality

The app keeps the original uploaded file untouched. It uses smaller previews while editing, then renders exports from the original image dimensions where possible. The stitched export is designed for high-quality sharing while avoiding overly large browser canvases on mobile.

## Running Locally

Because the app uses browser file upload and external client-side libraries, run it from a local static server:

```bash
python3 -m http.server 5174
```

Then open:

```text
http://127.0.0.1:5174/
```

## Sharing

If GitHub Pages is enabled for this repository, the public link is:

```text
https://bbxg16.github.io/photo_log/
```

After pushing updates to `main`, GitHub Pages may take a minute or two to refresh.

## Tech Stack

- HTML
- CSS
- JavaScript
- Fabric.js for editable text boxes
- SortableJS for image reordering
- heic2any for best-effort HEIC/HEIF conversion
