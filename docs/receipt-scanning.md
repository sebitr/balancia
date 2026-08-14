# Receipt scanning

Photograph a receipt, let Balancia read it, correct anything it got wrong,
say who had what, and create the expense. The reading happens in the browser,
on the device holding the photo. The image is not uploaded to be recognized,
and there is no OCR API key to configure, because there is no OCR API.

Off by default. It needs ~47 MB of model files and one extra
Content-Security-Policy token, and both of those are the operator's call.

## What it does, and what it does not

```
camera or photo library
        │
        ▼
  preprocessing        resize, EXIF rotation, contrast   (main thread)
        │
        ▼
  Web Worker ──────────────────────────────────────────────────┐
        │                                                       │
        ▼                                                       │
  onnxruntime-web       WebGPU if available, WebAssembly if not │
        │                                                       │
        ▼                                                       │
  PP-OCRv5 detection ──► boxes                                  │
        │                                                       │
        ▼                                                       │
  PP-OCRv5 recognition ─► text + confidence                     │
        │                                                       │
        └───────────────────────────────────────────────────────┘
        │
        ▼
  parser               merchant, date, items, totals
        │
        ▼
  validation           do the numbers reconcile?
        │
        ▼
  you review and correct every value
        │
        ▼
  item assignment ──► Balancia's ordinary exact split
```

The expense that comes out is an ordinary expense. It carries no trace of
having been scanned, the server recomputes its split with the same domain code
it uses for a split typed by hand, and nothing is ever created without someone
confirming it first.

## Where the code lives

| File                                 | What it does                                        |
| ------------------------------------ | --------------------------------------------------- |
| `src/modules/receipts/amounts.ts`    | Decimal separators, grouping, signs                 |
| `src/modules/receipts/dates.ts`      | Date formats, day-first by default                  |
| `src/modules/receipts/labels.ts`     | TOTAL / TVA / MwSt / IVA vocabulary, currency marks |
| `src/modules/receipts/lines.ts`      | Text boxes grouped back into receipt lines          |
| `src/modules/receipts/parser.ts`     | Lines to a `ParsedReceipt`                          |
| `src/modules/receipts/validation.ts` | Whether the numbers reconcile                       |
| `src/modules/receipts/assignment.ts` | Items and shared charges to per-person amounts      |
| `src/lib/ocr/config.ts`              | Model paths, sizes, the availability probe          |
| `src/lib/ocr/image-ops.ts`           | Resize maths, luminance, contrast                   |
| `src/lib/ocr/preprocess.ts`          | Photograph to pixels the detector can use           |
| `src/lib/ocr/worker-kernel.ts`       | The engine's arithmetic, as worker source           |
| `src/lib/ocr/worker-source.ts`       | The worker: runtime, sessions, inference            |
| `src/lib/ocr/scanner.ts`             | The page's typed handle on the worker               |
| `src/components/receipts/`           | Capture, progress, review, assignment               |

Everything under `src/modules/receipts` is pure and framework-free, so it runs
in a unit test against a fixture exactly as it runs in the browser after a
scan. That is what makes the parsing rules arguable: they are code you can
read, not weights you cannot.

## Installing it

`./scripts/bootstrap.sh` offers this as one of its setup questions, and
answering yes does everything below: the download, and `RECEIPT_SCANNING=true`
in `.env`. To do it by hand instead:

```bash
pnpm ocr:install --yes
```

That downloads ~47 MB into `public/models` (git-ignored):

| File                                               | Size    | What                            |
| -------------------------------------------------- | ------- | ------------------------------- |
| `ocr/ppocrv5-mobile-det.onnx`                      | 4.7 MB  | Text detection                  |
| `ocr/ppocrv5-mobile-rec.onnx`                      | 16.5 MB | Text recognition                |
| `ocr/ppocrv5_dict.txt`                             | 0.1 MB  | The recognizer's character list |
| `runtime/ort/ort.webgpu.min.mjs`                   | 0.1 MB  | onnxruntime-web API             |
| `runtime/ort/ort-wasm-simd-threaded.asyncify.wasm` | 25.4 MB | The runtime itself              |

As with the semantic categorization model, this is the only moment Balancia
talks to a model host, and it is an operator running a command rather than the
application. Afterwards everything is served from this instance.

Then set:

```bash
RECEIPT_SCANNING=true
```

That switch also adds `'wasm-unsafe-eval'` to the Content-Security-Policy,
which WebAssembly compilation needs and which is otherwise deliberately
absent. It permits WASM compilation and nothing else — it is not
`unsafe-eval`. Both this and `SEMANTIC_CATEGORIZATION` ask for the same one
token, through `isWebAssemblyInferenceEnabled()`, so the policy has a single
reason to be relaxed.

In Docker, `public/models` lives inside the image, so mount it to survive a
rebuild:

```yaml
services:
  app:
    volumes:
      - ./public/models:/app/public/models:ro
```

`compose.yaml` carries that line commented out, next to the `uploads` volume.
The path is `./public/models` because that is where `pnpm ocr:install` writes —
run it on the host, in the repository, then uncomment.

Two things have to be true for the feature to appear, and each fails silently
on its own:

- **`RECEIPT_SCANNING` has to reach the container.** `compose.yaml` forwards an
  explicit list of variables and nothing else, so a value set only in `.env`
  never arrives. It is named in the list; a hand-rolled deployment has to pass
  it too.
- **The models have to be in `public/models` inside the container.** Without
  the mount they are copied in at image build time, which means they are lost
  on the next `--build` unless reinstalled first.

If the files are missing, the browser's one `HEAD` request fails, no worker is
ever created and no scan button is rendered. Nothing to switch off.

### A note on the two WebAssembly binaries

`SEMANTIC_CATEGORIZATION` installs `ort-wasm-simd-threaded.jsep.wasm`;
this feature installs `ort-wasm-simd-threaded.asyncify.wasm`. They are not
interchangeable: at onnxruntime-web 1.23 the WebGPU bundle asks for the
asyncify build _by name_, and given the jsep files it fails with `no available
backend found`. An instance enabling both features therefore keeps both on
disk, at a cost of about 25 MB. No browser ever loads both.

## The model

**PP-OCRv5 mobile**, detection and recognition, from the PaddleOCR project.

Chosen because it is small enough to download onto a phone (21 MB for the pair
against hundreds of megabytes for a vision-language model), fast enough to be
worth waiting for, accurate on printed Latin text, and licensed so that
Balancia can redistribute it.

It is an OCR model and nothing more. A large vision-language model would read a
receipt more cleverly and would also be too large to ship, impossible to run on
a mid-range phone, and unable to explain itself — and the interesting part of
this feature is the splitting, not the reading.

### Licensing

| Component                                                | Licence    |
| -------------------------------------------------------- | ---------- |
| PP-OCRv5 weights (PaddleOCR, PaddlePaddle)               | Apache-2.0 |
| ONNX conversion (`bukuroo/PPOCRv5-ONNX` on Hugging Face) | Apache-2.0 |
| `ppocrv5_dict.txt` character list                        | Apache-2.0 |
| onnxruntime-web                                          | MIT        |

Apache-2.0 and MIT are both compatible with Balancia's AGPL-3.0-or-later
distribution. Nothing here is downloaded at build time or vendored into the
repository; the files are fetched by an operator, on purpose, into a
git-ignored directory.

PaddlePaddle publishes PP-OCRv5 in Paddle's own inference format rather than
ONNX, which is why the conversion comes from a third party. If you would rather
convert the official weights yourself, `paddle2onnx` produces equivalent files;
point `scripts/fetch-ocr-model.ts` at them.

## Execution providers

WebGPU when the browser has it, WebAssembly when it does not, and WebAssembly
again if WebGPU initialization throws — which happens on drivers that advertise
the API and then fail to allocate. **WebGPU is never required.**

Measured on the detection model, desktop Chrome, a 576×512 input:

| Provider    | Session creation | First inference | Warm inference |
| ----------- | ---------------- | --------------- | -------------- |
| WebGPU      | 87 ms            | 92 ms           | 33 ms          |
| WebAssembly | 376 ms           | 193 ms          | 116 ms         |

Threads are pinned to one. onnxruntime's threaded WebAssembly needs
`SharedArrayBuffer`, which needs cross-origin isolation, which Balancia does
not enable.

## Preprocessing

Deliberately minimal. PP-OCR was trained on photographs, and every filter
applied here is a filter it did not expect — aggressive thresholding in
particular destroys the thin strokes on thermal paper.

What is applied:

- **EXIF rotation.** A phone stores a portrait photo as landscape pixels plus
  a flag. Ignore the flag and a horizontal-text detector finds nothing.
- **Resize to 960 px on the long side.** A 12 megapixel photo is 48 MB of
  RGBA, and the float32 tensor from it another 145 MB. That allocation is what
  kills an iOS tab.
- **Contrast stretch, only when the photograph is flat.** Measured, not
  assumed: on a test image with a luminance range of 9, stretching took the
  parse from one item and no tax to all four items, the tax and the currency.
  A well-lit photo is left alone, because stretching it only amplifies noise.

Not applied: deskewing, perspective correction, denoising, adaptive
thresholding. The detector tolerates a few degrees of rotation on its own, and
the rest cost accuracy more often than they gain it. `image-ops.ts` is pure and
each step is separable, so any of them can be added and measured.

## Reading the numbers

The decimal separator is the most dangerous thing on a receipt: read `1.234` as
twelve-thirty-four and the split is wrong by two orders of magnitude with
nothing on screen looking broken.

The rule is decided from the _shape of the number_, never from the reader's
locale — a Swiss group photographing an Italian receipt would break any
assumption tied to the phone:

> The last separator is the decimal point, unless it is followed by exactly
> three digits, in which case it is a thousands separator.

```
12.50      → 12.50        1'234.50   → 1234.50
12,50      → 12.50        1 234,50   → 1234.50
1.234,50   → 1234.50      1,234.50   → 1234.50
1.234      → 1234.00      1,234.500  → 1234.500  (three-digit currencies)
```

When both marks appear, the last one is the decimal point whatever follows it.
Anything that does not fit returns nothing rather than a guess.

Dates are read day-first when genuinely ambiguous, and unambiguous readings —
a day above 12, a month name, an ISO date — always win. `13.08.202620:14`,
where the recognizer dropped the space before the time, is handled: that came
from a real run, not from imagination.

## Validation

OCR gets digits wrong invisibly: `19.00` misread as `19.60` still looks like a
price. What it cannot fake is arithmetic.

```
Σ items          ≈ subtotal
subtotal + charges ≈ total
Σ items          ≤ total
```

Anything that does not reconcile within two minor units — enough for ordinary
rounding, including the Swiss habit of rounding cash to five rappen — is
**reported, never corrected**. Silently adjusting a value would hide exactly
the error the check exists to find.

This is not theoretical. On a deliberately degraded test photograph the
recognizer read the tax as `7785.10` instead of `5.10`; the total and every
item were right. The parts-against-total check caught it.

Warnings are recomputed from what is currently in the fields, so correcting a
number makes its warning disappear.

## Splitting by item

The part worth having. Reading a total saves a little typing; knowing that
Julie only had the tiramisu is the tedious, error-prone bit.

```
Margherita  19.00   [Seb]
Carbonara   24.50   [Alex]
Beer ×2     14.00   [Seb] [Alex]
Tiramisu     9.50   [Julie]

Shared charges: 5.10
  (•) In proportion to what each person had
  ( ) Equally
```

An item shared by several people is split equally between them. Shared charges
are computed as a **residual** — `total − Σ assigned items` — rather than as
`tax + tip + service`, for three reasons, all about the sum being exactly
right:

- the parts are OCR output and may not add up, while the total is the number
  the user confirmed;
- a charge the parser never saw (a cover charge, a rounding line, a discount)
  is still distributed rather than dropped;
- `Σ shares === total` then holds _by construction_, for every input, including
  the ones where the receipt contradicts itself.

That last point is why the misread `7785.10` tax above could not have corrupted
the split even if the user had ignored the warning: the tax figure is not an
input to the allocation.

Everything then goes through `allocateByWeights` and `resolveSplit` — the same
largest-remainder allocator and the same split engine as every other expense in
Balancia. There is no second accounting implementation, and `resolveSplit`
re-checks that the parts sum to the total before anything is stored.

`assignment.test.ts` asserts the invariant as a property over 300 generated
assignments, strategies and totals.

## Privacy

- The image is never uploaded for recognition. There is no cloud OCR call,
  no third-party inference API, and no key for one.
- The models are fetched from this instance's own origin. The worker's source
  contains no host at all — the only origin it can use is the one it is running
  on, and `worker-kernel.test.ts` asserts that no URL scheme appears in it.
- Recognized text is never logged and never leaves the page. Errors crossing
  back from the worker carry the message only, never the stack and never the
  payload, because an exception raised mid-read can otherwise contain fragments
  of the receipt.
- Nothing is persisted until the user confirms it, and what is persisted is an
  expense: amounts, a description and a date.

### Storing the receipt is a separate decision

Recognition is local. Storage is not, and the interface says so rather than
letting the first fact imply the second:

> Recognition happens on this device. The photo is not sent anywhere to be
> read.
>
> ☐ Also keep the photo with this expense
> _The image stays on this device. Only the amounts you confirm are saved._

Tick the box and the copy changes to say the image will be uploaded and stored
with the expense on this server — through the ordinary attachment flow,
unchanged, the same one the paperclip button has always used.

## Offline and caching

The models are cached by the service worker on first use, `CacheFirst`, in
`balancia-models-v1`. They are deliberately **not precached**: together they
are tens of megabytes, and precaching would download the lot on every install,
including for the majority who never scan a receipt. The production precache
manifest is unchanged by this feature.

So the first scan needs the network and later scans do not — including with no
connection at all, since everything after the image is local.

The cache name carries a version because the files are served from stable
paths. An operator installing newer models bumps `MODEL_CACHE` in
`src/app/sw.ts`, and browsers holding the old bytes fetch the new ones instead
of serving a model the current worker cannot use.

## Failure modes

Each of these has its own message, and all of them leave the expense form
working exactly as it did before:

| Failure                             | What happens                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Browser has no Worker / WebAssembly | No scan button; the form is unchanged                                          |
| Models not installed                | No scan button (one `HEAD` request decides)                                    |
| WebGPU initialization fails         | Retried automatically on WebAssembly                                           |
| Model download fails                | "Check your connection and try again"                                          |
| Image cannot be decoded             | "Try a JPEG or PNG"                                                            |
| No text found                       | Advice about lighting, flatness and framing                                    |
| No total found                      | Items are still offered; the total is asked for, with the items' sum suggested |
| Scan exceeds 3 minutes              | Stopped, with a suggestion to use a smaller photo                              |
| One unreadable line                 | Skipped; the rest of the receipt survives                                      |

## Testing

```bash
pnpm test:unit
```

The deterministic pieces are covered against fixtures rather than by running
the models: amount parsing across separator conventions, dates, label
vocabulary, line grouping, the parser against synthetic Swiss, French, German,
Italian, US, quantity-notation, large-amount and badly-detected receipts,
validation, and the split conversion.

The worker's kernel is source text, so nothing type-checks it. Its tests
evaluate that exact text and run it — the CTC decoder's collapsing rule, the
CRLF handling in the character list, connected components, and the bilinear
crop — because every bug that file has had was invisible in review.

No fixture is a real receipt. They are written by hand, and none contains
anybody's card number, tax ID or dinner.
