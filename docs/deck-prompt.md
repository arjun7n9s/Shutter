# Idea deck: plan and generator prompt

SIH idea submissions usually use the official six-section template: title, proposed solution,
technical approach, feasibility and viability, impact and benefits, research and references. The
plan below fits those sections into 9 slides. If the official template is mandatory, keep its
section headers and use these slides as its content.

## Slide plan

1. **Title.** Parda: a veil between your data and the agent.
2. **Problem.** Browser agents send screenshots of your Aadhaar, bank and inbox pages to a server model.
3. **Insight.** Redact in the pixels, before the network, and let the model act on typed placeholders.
4. **Solution.** On-device perception, raster redaction and a token vault, with three capabilities.
5. **Technical approach.** The architecture, from page to redacted frame to Fara-1.5 to actions resolved locally.
6. **Proof.** Measured numbers, including the blind held-out corpora and their honest gaps.
7. **Safety by construction.** Capabilities, consent, target re-check, tripwire, offline serving.
8. **Feasibility and impact.** The cost on device, fully open weights, and who uses it.
9. **Roadmap and references.** On-device NER, live Fara-1.5 task success, Firefox, and sources.

## Prompt

```text
Create a polished 9-slide idea pitch deck for PARDA, an entry for Smart India Hackathon 2026, problem statement SIH26171 ("On-device Visual Perception for Light-weight Browser Agents", ISRO). Audience: SIH evaluators judging visual-context accuracy, PII detection precision/recall, redaction precision, client resource use and latency.

Narrative goal:
Browser agents work by sending screenshots to a large vision-language model on a server, which means every Aadhaar number, bank balance and inbox on screen leaves the user's device. Parda puts a veil in the browser: it perceives the page on-device, replaces every personal value with a typed placeholder like [AADHAAR_1] directly in the screenshot pixels, and sends only that redacted frame. An open-weights computer-use model (Microsoft Fara-1.5, served offline with vLLM) plans actions on the placeholders; the extension resolves them back to real values locally, only into compatible fields, only after the user approves. Show that it works with measured numbers, including honest blind-test results and the remaining gap.

Slide plan:
1. PARDA / A VEIL BETWEEN YOUR DATA AND THE AGENT - Title slide. Subtitle: "On-device redaction for browser agents. SIH26171 · ISRO." Corner labels: [TEAM NAME], [COLLEGE], "SIH 2026". Hero visual: a browser screenshot where an Aadhaar number and a name are replaced by yellow placeholder chips [AADHAAR_1] and [PERSON_1].
2. YOUR AGENT SEES EVERYTHING - Problem. Three short fragments: "Agents act on screenshots." "Screenshots go to a server model." "Aadhaar, PAN, bank, OTP, faces — all in the frame." One line: "Blanket blurring kills the task; no redaction kills privacy."
3. REDACT THE PIXELS, NOT THE PROMPT - Insight. The model never needs the value, only its role. "[EMAIL_1] is an email. That is enough to fill a form." Show a before/after pair: raw frame vs Parda frame with typed chips.
4. PERCEIVE. VEIL. ACT. - Solution, three columns: (1) Perceive on device: DOM text, form fields, shadow DOM, same-origin frames, SVG, CSS content; India-specific detectors with Verhoeff, Luhn and GSTIN checksums; face and QR detection in the browser. (2) Veil in pixels: typed placeholder chips and solid masks painted into the screenshot, verified pixel-by-pixel before encoding; refuses to send if the page moved or the tab changed. (3) Act locally: the model returns actions on placeholders; the extension fills real values only into compatible fields on the right site, after consent; passwords, OTPs and CVVs are never released.
5. THE DATA NEVER CROSSES THE LINE - Technical approach. A left-to-right pipeline drawn as a bold poster diagram with a thick vertical dividing line labelled "DEVICE | SERVER": Page → Perception → Detectors → Raster redaction → Redacted frame ──(only this crosses)──▶ Parda adapter → Fara-1.5 on vLLM (offline, no internet route) → action with tokens ◀── back across → Policy & token vault → Page. Small labels: "Chrome MV3 · WXT · ONNX Runtime Web · RF-DETR Nano · YuNet · zxing" on the device side; "FastAPI · vLLM · Fara-1.5-4B/9B open weights" on the server side.
6. MEASURED, NOT PROMISED - Proof. A stark numbers table:
   Development corpus, 120 pages: 100% PII items masked, 0% PII pixels leaked, 96.8% of non-PII text kept readable (blanket masking keeps 0%).
   Blind held-out corpora written by other AI models that never saw our code, first run: 72.3% item recall on both; after adding a name gazetteer, held-out 2 rose to 84.8% recall with 90.6% detection precision.
   Aadhaar, PAN, GSTIN, bank account and card numbers: 100% recall in blind runs.
   On-device screen ViT on Chromium canvas e-IDs: DOM sees 0% of canvas PII; the ViT covers the glyphs. WASM in Chrome 551 ms median. Fake server accepts the redacted JPEG (HTTP 200, no tripwire).
   On-device cost: 2.9 ms median DOM perception + planning per page; 47 KB content script.
   Footnote in small type: "Weakest today: unlabelled names and free-text addresses in the DOM; ID_DOCUMENT also boxes shipping labels. Next: on-device NER and a live Fara-1.5 task-success run."
7. SAFE BY CONSTRUCTION - Five short stamped lines: "Only a verified redacted frame can be sent." "Values stay on the site they came from." "Passwords, OTPs, CVVs: never released." "The element you approved is the element clicked." "Server rejects any request with raw PII." Motif stamp: "VERIFIED REDACTED".
8. LIGHT ENOUGH FOR EVERY LAPTOP - Feasibility and impact. Columns: "Runs in the browser: no GPU on the client." "Open weights, runs offline: Fara-1.5 on one GPU, air-gappable." "Who: citizens on government portals, bank and GST users, enterprise agents handling customer data." One line: "Privacy becomes a property of the pipeline, not a policy promise."
9. NEXT: SEE NAMES LIKE A HUMAN DOES - Roadmap and references. Roadmap: on-device NER for unlabelled names and addresses; end-to-end task-success evaluation with Fara-1.5; Firefox port. References: Microsoft Fara (github.com/microsoft/fara), RF-DETR (Apache-2.0), vLLM, OpenCV Zoo YuNet, ONNX Runtime Web, UIDAI Verhoeff checksum, GSTIN check-digit specification. Closing line: "The agent does the work. Your data stays home."

Visual direction:
Use a bold retro-editorial poster-style pitch deck aesthetic: vintage propaganda/magazine poster meets modern startup deck. Make it high-contrast, confident, and graphic-design-forward.

Strict color palette only:
- Vivid orange-red: #F04E2E
- Warm cream/off-white: #F3E9D8
- Near-black: #111111
No other colors except occasional black-and-white photography. The only exception is the placeholder chips in product screenshots, which are pale yellow #FFE58F with dark text because that is how the product renders them.

Typography:
Use massive heavy condensed uppercase sans-serif headlines, Anton-style or bold grotesque. Headlines should span the full width where possible and may bleed off slide edges. Body text should be small, clean, tight sans-serif in restrained columns.

Layout and texture:
Alternate slide backgrounds between orange-red, cream, and near-black. Add subtle distressed grain or halftone texture. Use strong asymmetry, oversized typography, big negative space, small uppercase corner labels (slide number, "SIH26171", section name), rotated edge labels, and one recurring motif: a thick black redaction bar with a small cream placeholder label like [PERSON_1], used as a graphic accent, a divider, and a stamp. Use black-and-white photography in clean rectangular frames only when it adds meaning (a hand on a laptop, a government office counter).

Content rules:
Keep text minimal and punchy. Use short phrases, not paragraphs. Prioritize proof, architecture, demo flow, and differentiation. Do not use generic corporate deck styling, gradients, pastel colors, decorative blobs, or dense text. Every number on the proof slide must appear exactly as given; do not round or invent metrics.

Generate the deck with speaker-note-friendly clarity, but keep visible slide text sparse and poster-like.
```

## Placeholders to fill

`[TEAM NAME]` and `[COLLEGE]`. The screenshots for slides 1 and 3 are in
`bench/out/samples/*_raw.png` and `*_parda.jpg` after running the benchmark. `profile_kv` and
`form_prefilled` read best.
