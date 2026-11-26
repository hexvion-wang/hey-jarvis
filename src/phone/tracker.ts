import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision';

// 版本要跟 package.json 裡的 @mediapipe/tasks-vision 一致
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export type Delegate = 'GPU' | 'CPU';

export interface Tracker {
  delegate: Delegate;
  detect(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult;
}

/** 建立手部追蹤器：優先用 GPU，失敗時退回 CPU */
export async function createTracker(): Promise<Tracker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);

  const make = (delegate: Delegate) =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let landmarker: HandLandmarker;
  let delegate: Delegate = 'GPU';
  try {
    landmarker = await make('GPU');
  } catch (e) {
    console.warn('GPU delegate 失敗，改用 CPU', e);
    delegate = 'CPU';
    landmarker = await make('CPU');
  }

  return {
    delegate,
    detect: (video, ts) => landmarker.detectForVideo(video, ts),
  };
}

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;
