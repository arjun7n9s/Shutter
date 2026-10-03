import type { InferenceSession } from "onnxruntime-web";
import { assetExists, assetUrl, configureOrt, createSession, letterbox } from "./ort";
import { nms, type Detection, type Frame, type VisionCls, type VisionModel } from "./types";

const MODEL = "/models/screen-vit.onnx";
const META = "/models/screen-vit.json";

interface Meta {
  resolution: number;
  /** Logit index -> class name; null for unused indices. */
  classes: Array<VisionCls | null>;
  thresholds?: Partial<Record<VisionCls, number>>;
  mean?: [number, number, number];
  std?: [number, number, number];
  stretch?: boolean;
}

const MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const STD: [number, number, number] = [0.229, 0.224, 0.225];

/**
 * Parda's screen ViT: RF-DETR Nano (Apache-2.0, DINOv2 ViT backbone, COCO-pretrained) fine-tuned
 * on synthetic Indian-portal screens. It finds documents, signatures,
 * portraits, rendered personal text and controls from pixels alone, so redaction still works where
 * the DOM says nothing (canvas apps, screenshots of documents, image-rendered text). Sensitive
 * classes are masked; buttons and inputs are reported to the model as coordinates, never as text.
 */
export class ScreenVit implements VisionModel {
  readonly name = "parda-screen-vit";
  private session: InferenceSession | null = null;
  private meta: Meta | null = null;
  backend = "";

  async load(): Promise<boolean> {
    if (this.session) return true;
    if (!(await assetExists(MODEL)) || !(await assetExists(META))) return false;
    this.meta = (await (await fetch(assetUrl(META))).json()) as Meta;
    const { session, backend } = await createSession(MODEL);
    this.session = session;
    this.backend = backend;
    return true;
  }

  async detect(frame: Frame): Promise<Detection[]> {
    if (!this.session || !this.meta) return [];
    const ort = configureOrt();
    const R = this.meta.resolution;
    const { data } = letterbox(frame.image, R, {
      mean: this.meta.mean ?? MEAN,
      std: this.meta.std ?? STD,
      scale255: true,
      stretch: this.meta.stretch !== false,
    });
    const out = await this.session.run({ [this.session.inputNames[0]!]: new ort.Tensor("float32", data, [1, 3, R, R]) });
    const [boxName, logitName] = this.session.outputNames.includes("dets") ? ["dets", "labels"] : this.session.outputNames;
    const boxes = out[boxName!]!.data as Float32Array;
    const logits = out[logitName!]!.data as Float32Array;
    const nq = boxes.length / 4;
    const nc = logits.length / nq;
    const W = frame.image.width / frame.scale;
    const H = frame.image.height / frame.scale;
    const dets: Detection[] = [];
    for (let q = 0; q < nq; q++) {
      let best = -Infinity;
      let bi = -1;
      for (let c = 0; c < nc; c++) {
        const v = logits[q * nc + c]!;
        if (v > best) {
          best = v;
          bi = c;
        }
      }
      const cls = this.meta.classes[bi];
      if (!cls) continue;
      const score = 1 / (1 + Math.exp(-best));
      if (score < (this.meta.thresholds?.[cls] ?? 0.5)) continue;
      const [cx, cy, bw, bh] = [boxes[q * 4]!, boxes[q * 4 + 1]!, boxes[q * 4 + 2]!, boxes[q * 4 + 3]!];
      dets.push({ rect: { x: (cx - bw / 2) * W, y: (cy - bh / 2) * H, w: bw * W, h: bh * H }, cls, score, model: this.name });
    }
    const byCls = new Map<VisionCls, Detection[]>();
    for (const d of dets) byCls.set(d.cls, [...(byCls.get(d.cls) ?? []), d]);
    return [...byCls.values()].flatMap((g) => nms(g, 0.6));
  }
}
