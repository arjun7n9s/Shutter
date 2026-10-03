import type { InferenceSession } from "onnxruntime-web";
import { assetExists, configureOrt, createSession, letterbox } from "./ort";
import { nms, type Detection, type Frame, type VisionModel } from "./types";

const MODEL = "/models/face_detection_yunet_2023mar.onnx";
const SIZE = 640;
const STRIDES = [8, 16, 32] as const;

/** YuNet (OpenCV Zoo, MIT). Input is BGR 0-255; decoding follows OpenCV's FaceDetectorYN. */
export class YuNet implements VisionModel {
  readonly name = "yunet-2023mar";
  private session: InferenceSession | null = null;
  backend = "";

  constructor(private readonly threshold = 0.6) {}

  async load(): Promise<boolean> {
    if (this.session) return true;
    if (!(await assetExists(MODEL))) return false;
    const { session, backend } = await createSession(MODEL);
    this.session = session;
    this.backend = backend;
    return true;
  }

  async detect(frame: Frame): Promise<Detection[]> {
    if (!this.session) return [];
    const ort = configureOrt();
    const { data, ratio } = letterbox(frame.image, SIZE, { bgr: true });
    const input = new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]);
    const out = await this.session.run({ [this.session.inputNames[0]!]: input });
    const dets: Detection[] = [];
    for (const s of STRIDES) {
      const cls = out[`cls_${s}`]!.data as Float32Array;
      const obj = out[`obj_${s}`]!.data as Float32Array;
      const box = out[`bbox_${s}`]!.data as Float32Array;
      const cols = SIZE / s;
      for (let i = 0; i < cls.length; i++) {
        const score = Math.sqrt(Math.min(Math.max(cls[i]!, 0), 1) * Math.min(Math.max(obj[i]!, 0), 1));
        if (score < this.threshold) continue;
        const r = Math.floor(i / cols);
        const c = i % cols;
        const cx = (c + box[i * 4]!) * s;
        const cy = (r + box[i * 4 + 1]!) * s;
        const w = Math.exp(box[i * 4 + 2]!) * s;
        const h = Math.exp(box[i * 4 + 3]!) * s;
        const k = 1 / ratio / frame.scale;
        dets.push({ rect: { x: (cx - w / 2) * k, y: (cy - h / 2) * k, w: w * k, h: h * k }, cls: "FACE", score, model: this.name });
      }
    }
    // Pad faces generously: hairline and ears identify people too.
    return nms(dets, 0.3).map((d) => ({
      ...d,
      rect: { x: d.rect.x - d.rect.w * 0.25, y: d.rect.y - d.rect.h * 0.35, w: d.rect.w * 1.5, h: d.rect.h * 1.6 },
    }));
  }
}
