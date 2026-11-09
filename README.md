# pixelsort-go

A pixel sorter you can **watch** — live, in the browser, along any angle.

The engine is Go, compiled to WebAssembly, so the sorting runs on whatever device loads the page. A SvelteKit
front end drives it and a small Go server keeps the gallery. It is a ground-up rewrite of the Python/Gradio
[Pixelsorting](https://github.com/AutumnsGrove/Pixelsorting), which stays as an archive of the original.

| Before | After |
|---|---|
| ![The sample photograph, unsorted](docs/images/before.jpg) | ![The same photograph sorted along 35 degrees](docs/images/after.jpg) |

*Sorted along 35° with `{"angle":35,"mode":"random","length":180,"randomness":10,"key":"luma","algo":"oddeven"}` —
no rotated edges, no transparent corners.*

**[Every screen, and more of what the engine does, is in the gallery →](docs/gallery.md)**

## What it does

- **Any angle, no rotation.** Pixels are partitioned into staircase lines with `k = y − round(x·tanθ)` — a pure
  permutation, so no lossy rotate-and-crop and no transparent corners.
- **Watch the sort itself.** Stable, visible algorithms advance a step at a time on the same buffer; the last
  frame is guaranteed to equal the instant result. Turn on Loop and the finished sort walks back down to the
  original and starts again.
- **Regions, not reassembly.** Masks and geometric segmentation are one idea: a map of cells and classes, each
  free to freeze, turn, re-key or re-cut. One pass, one buffer, no seams.
- **Take the sort with you.** Export the process as a GIF, APNG, MP4 or WebM from the studio, or as GIF/APNG (plus a PNG sequence for ffmpeg)
  from the CLI with `render --anim`; exports land in the Archive and share like images, frame-for-frame deterministic.
  Infinity mode plays the sort and then unsorts back to the original, so the loop has no seam.
- **Everything runs on your device.** The server serves files and stores results; it never touches pixels.

## Try it

Requires Go 1.27, Node, `pnpm` and `golangci-lint` v2.

```bash
make embed-build
./build/pixelsort-go serve     # http://127.0.0.1:8895
```

| Command | What it does |
|---|---|
| `make check` | format check, vet, lint and the fast tests — run before every commit |
| `make test` | every Go test, with the race detector |
| `make fuzz` | a short run of every fuzz target |
| `make wasm` `make wasm-test` | the engine as WebAssembly, and its tests under Node |
| `make web` `make e2e` | the SvelteKit app, and its browser tests |
| `make image` `make compose-test` | the container image, and a check of it |
| `make bench` `make hello` `make spike` | benchmarks, and small ways to poke the engine |

## Security

Sorting happens in your browser; the server never touches pixels. The service makes outside calls, but only to its
own Cloudflare Worker, carrying only what you explicitly share or fetch. It never contacts the image registry (a
small watcher on the host does, and the app cannot name an image). There are no accounts: access is your tailnet.
"Unlisted" share links are not private. The container runs read-only, as a non-root user, with every capability
dropped.

## Credits

The technique descends from [satyarth/pixelsort](https://github.com/satyarth/pixelsort) (MIT) and, before it,
Kim Asendorf's *ASDF Pixel Sort* Processing script. Icons use [Lucide](https://lucide.dev). GIF encoding uses
[gifenc](https://github.com/mattdesl/gifenc) (MIT); video muxing uses [Mediabunny](https://mediabunny.dev) (MPL-2.0). Mockup type is
[Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) and
[DM Mono](https://fonts.google.com/specimen/DM+Mono). Studio's first-run sample is an aerial forest photograph
from [Unsplash](https://unsplash.com) (<https://images.unsplash.com/photo-1793556119647-46da040a5a4c>), used
under the Unsplash License.

## License

[MIT](LICENSE) © 2026 Autumn Brown
