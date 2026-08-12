# Photo Log Editor

A lightweight browser-based editor for turning multiple photo-log images into long vertical share images.

Photo Log Editor is designed for people who want to upload a larger set of images, choose a batch to stitch together, optionally add text to some images, reorder the selected batch, and export one long image for Weibo, WeChat Moments/Friends Circle, or other social platforms.

## What It Does

- Upload up to 50 photos in one session.
- Select a batch of uploaded photos to stitch together.
- Recommended batch size is up to 15 images, but the app does not block larger batches.
- Move selected batch images out of the available pool while that long image is being made.
- Edit selected images one by one with simple Back and Next navigation.
- Skip text edits by pressing Next.
- Add one or more editable text boxes directly on an image.
- Adjust text size with a simple number input.
- Choose preset colors or use the custom color picker.
- Choose simple system font styles for Chinese and English text, including a handwritten-style option when available.
- Set text background to none, white, or black.
- Drag text boxes into place.
- Rotate images and crop to Original, 4:3, 1:1, or 16:9.
- In crop mode, move the image and pinch or scroll to zoom into the part you want to keep.
- Review all selected images in order before stitching.
- Reorder the selected batch.
- Tap an image in the review step to edit its text again.
- Export one long vertical stitched image.
- Return to remaining uploaded images and start another stitched image without reuploading.

## Workflow

1. Upload images.
2. Select the images for one long stitched image.
3. Press Next.
4. Move through the selected images one by one.
5. Add text, rotate, or crop where needed, or press Next to skip.
6. Review the selected batch in order.
7. Reorder images if needed.
8. Tap any image to edit it again.
9. Press Stitch & Download.
10. Return to the remaining uploaded images and start another batch, or upload more images.

After a batch is stitched, those images are removed from the available image pool. This makes it easier to create several long images from one upload session without accidentally reusing the same photos.

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

JPEG is the primary target, including larger JPEG files. For iPhone Live Photos, the app only works with the still image.

## Image Quality

The app keeps the original uploaded file untouched. It uses lightweight thumbnails and previews while editing, then renders the final stitched export from the original images where possible, including crop, rotate, and text edits. For very large or very long stitched images, the export width may be reduced automatically to avoid browser memory crashes, especially on mobile.

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
