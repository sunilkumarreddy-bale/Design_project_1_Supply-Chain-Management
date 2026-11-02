# Camera (QR scanner) test

Run on 2026-11-02 in a real Chromium against a freshly seeded stack. Chromium's fake camera
(`--use-file-for-fake-video-capture`) plays a video of a QR code, so the scanner decodes it exactly as it
would from a webcam. Script: `frontend/e2e/camera.mjs` (`npm run e2e:camera`).

## Results: 8 of 8 checks pass

| Check | Result |
|---|---|
| Scan page: camera starts and plays live video (640 × 480) | Pass |
| Product QR shown to the camera is decoded (SKU-BAT-004): product card and stock table appear | Pass |
| Scan-to-act after a camera scan: dispatch 1 unit by FEFO | Pass ("Dispatched 1: 1 from BAT-2601") |
| Stop camera releases the camera | Pass |
| A Stock DNA label shown to the camera on the Scan page opens that lot's page | Pass (also with the two labels the bundled decoder cannot read, below) |
| Stock DNA page → "Scan label" dialog → camera → lot page | Pass |
| Camera permission denied: clear message, typing the SKU still works | Pass |
| No camera on the device: clear message, no crash | Pass |

Unit tests (`src/test/QrScanner.test.tsx`, run in CI):
- a decoded code reaches the page once;
- denied and missing cameras show their messages;
- React never renders inside the scanner library's element.

## Bugs found and fixed

1. **Crash on Start camera.** React drew the "Camera is off" text inside the element that html5-qrcode takes over.
   When the camera started, the library removed that text, and React then failed with `removeChild`, so the
   scanner never showed video. Every camera scan in the app was affected. The library now gets its own empty
   element.
2. **Dense labels cropped.** The fixed 220 px scan box cut off Stock DNA labels that fill the view. The box is
   now 70% of the camera view's shorter side.
3. **Some valid QR codes never decode.** The zxing decoder bundled in html5-qrcode failed on clean, valid
   codes. For the 17 seeded DNA codes it missed:
   - 1 at error-correction level L,
   - 1 at M,
   - 0 at Q,
   - 4 at H,
   - 3 of 17 of the labels as the app draws them.

   Every frame is now also passed to **jsQR**, which decoded all **110 of 110** test images: 34 app-rendered
   labels (two sizes), 68 DNA codes at all four levels, and 8 product QR codes. html5-qrcode still manages the
   camera, as the stack in the specification requires.

DNA labels now also use error-correction level Q (for scuffed printed labels) and the standard 4-module
quiet zone.

## Not covered here

- A physical phone camera: focus, glare, motion blur and low light are not simulated.
- iOS Safari, and HTTPS on a real host. Browsers only allow the camera on HTTPS or `localhost`.

Test these by hand on the deployed site.

## How to run it yourself

```bash
# stack running and seeded (API :4000, Vite :5173)
node -e "require('qrcode').toFile('sku.png','SKU-BAT-004',{width:360,margin:4})"     # in backend/
ffmpeg -loop 1 -i sku.png -t 6 -vf "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white" -pix_fmt yuv420p -r 10 sku.y4m
# same for a DNA code taken from the Stock DNA page -> dna.y4m
cd frontend && CAM_SKU_VIDEO=$PWD/sku.y4m CAM_DNA_VIDEO=$PWD/dna.y4m DNA_CODE=DNA-... npm run e2e:camera
```
