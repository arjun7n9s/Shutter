# Parda threat model

## Assets

The user's personal data as it appears in the browser: identity numbers (Aadhaar, VID, PAN, passport,
voter ID, driving licence), financial data (card, CVV, expiry, bank account, IFSC, UPI, GSTIN),
contact data (name, phone, email, address, PIN code, DOB), credentials (passwords, OTPs, API keys,
bearer tokens), faces and machine-readable codes (QR, PDF417).

## Adversaries

1. **The server and everything behind it.** This includes the model host, logs, and anyone who
   compromises it. It is trusted to plan actions, but not to see personal data.
2. **The web page.** It controls DOM, CSS and timing, and may try to smuggle data into the frame,
   forge tokens, inject instructions, or trick the agent into typing released values into the wrong
   place.
3. **The network path** between extension and server.

The user, the browser and the extension itself are trusted.

## Guarantees and how they are enforced

| Guarantee | Mechanism | Where |
|---|---|---|
| Only redacted pixels leave the device | `RedactedFrame` branded type is the only thing the client serializes; renderer paints masks, reads every mask back, refuses to encode on mismatch | `extension/lib/render.ts`, `client.ts` |
| The frame shows the page that was perceived | Tab must be active before and after `captureVisibleTab` with no `tabs.onActivated` in between; perceive-capture-perceive must agree on URL, scroll, every finding's value, class and rects, and probe geometry; 4 attempts then refuse | `pipeline.ts` |
| Page text is detected wherever it paints | Text nodes in document, open and closed shadow roots, same-origin iframes, SVG; `::before`/`::after` content; input values and placeholders; expanded listbox options. Cross-origin frames, embeds and objects are masked solid. Images, video, canvas and CSS background images are masked in strict mode | `perceive.ts` |
| Placeholders cannot be forged by the page | Token-shaped text in the page is masked in pixels and defanged in text (`[X_1]` → `(X-1)`) | `perceive.ts`, `sanitize.ts` |
| Text channels carry no raw values | Instruction, URL, user replies, refusal reasons, `read_page` text all pass through the same detectors; accessible names are sanitized before they can appear in reasons | `agent.ts`, `sanitize.ts` |
| Released values go only where they belong | Class compatibility (`fillCompatible`), origin binding for page-sourced values, `NEVER_RELEASE` for password/OTP/CVV/secret, user consent card showing the real value locally | `vault.ts`, `policy.ts` |
| The approved target is the executed target | Fingerprint of the target (tag, role, type, field class, name, origin, href, editable, visibility) taken at decision time is re-derived in the page right before click/hover/type; mismatch refuses | `policy.ts`, `act.ts` |
| The browser does not exfiltrate on the agent's behalf | Navigations with tokens or detectable PII in the (decoded) URL are denied; non-http(s) schemes denied; cross-origin navigation requires consent | `policy.ts` |
| Server-side regressions are visible | Tripwire rejects requests whose text still contains email, UPI, Aadhaar (Verhoeff), card (Luhn), PAN, GSTIN, phone or common secret formats; counts model echoes | `server/parda_server/tripwire.py` |
| Nothing else is contacted | Extension CSP `connect-src 'self' <server>`; ONNX Runtime and zxing WASM served from the extension; model container on an internal network | `wxt.config.ts`, `docker-compose.yml` |

## What the server still learns

- Page layout, and all non-PII text and imagery. This is required for the task.
- The legend, which lists how many values of each class appear, and their positions in the frame.
- The origin and path of the URL.

## Residual risks (known, not yet mitigated)

- **Detection misses.** On blind corpora, unlabelled names and prose addresses are the weak classes:
  person 59.9% and address 50% on held-out 2 (see README). A missed name is sent in clear.
- **Browser-native UI in the capture.** Autofill dropdowns and similar widgets are drawn by the
  browser, not the DOM. Whether `captureVisibleTab` includes them depends on platform and version,
  and Parda does not perceive them.
- **Flash content.** A page that paints PII only during the capture instant, and restores identical
  DOM before the second perception, is not detected by the stability check. Pixel-diffing two
  captures would close this, at the cost of latency.
- **Canvas and image text in non-strict mode.** With strict media off, masking depends on the
  screen ViT, YuNet and zxing. On held-out synthetic layouts the ViT covers 77.6% of sensitive
  pixels and 100% of faces on those layouts; on Chromium-rendered canvas e-IDs the same ONNX
  covers the glyphs the DOM cannot see. `ID_DOCUMENT` on mixed form pages is ignored unless the
  box sits on a canvas/image, so the form itself is not painted out. Real photographs of IDs
  are unmeasured.
- **User-sourced values are portable by design.** A value the user typed in the instruction can be
  filled on another origin after consent. A convincing phishing page with an `autocomplete=email`
  field would still get the user's email if the user approves.
- **Visibility is opacity-based.** Clickjacking via a visually identical overlay is not detected.
- **Model echoes.** If a value ever leaked, the model's replayed output would carry it. The server
  counts these but does not strip them.
