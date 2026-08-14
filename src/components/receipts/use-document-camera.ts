"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isCredibleDocument,
  isWithinFrame,
  normalizeCorners,
  scaleCorners,
  type DocumentCorners,
  type Size,
} from "@/lib/doc-scan/geometry";
import {
  isLiveCameraSupported,
  loadDocumentScanner,
  type DocumentScannerEngine,
} from "@/lib/doc-scan/engine";
import { CornerTracker, type ScannerStatus } from "@/lib/doc-scan/tracking";

/**
 * The live document camera: a rear-camera stream, a detection loop over a
 * reduced copy of it, and a capture path that re-detects on the full frame.
 *
 * Detection runs on a timer around 7 Hz, never concurrently (the work is
 * synchronous, and `#processing` guards the logical invariant), and never on
 * full-resolution frames — the preview loop sees at most `DETECTION_SIDE`
 * pixels on the long side. The capture path is independent: it always copies
 * the video at its full `videoWidth × videoHeight`, re-detects there rather
 * than trusting corners from up to 150 ms ago, and only then crops.
 *
 * The engine and the camera start in parallel and neither waits for the
 * other. A camera without the engine is still a camera: the shutter works
 * from the moment the video plays, and a capture without a detected document
 * simply returns the plain photograph.
 */

export type CameraFault =
  | "unavailable"
  | "denied"
  | "notFound"
  | "startFailed"
  | "captureFailed";

export type DetectionState = "loading" | "ready" | "failed";

export interface DocumentCapture {
  readonly file: File;
  /** False when the shutter fell back to the uncropped camera frame. */
  readonly documentDetected: boolean;
}

export interface DocumentCameraHandle {
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly status: ScannerStatus;
  /** Smoothed corners, normalized to the camera frame; null while searching. */
  readonly corners: DocumentCorners | null;
  /** The camera frame's pixel size, once known. Changes on rotation. */
  readonly frameSize: Size | null;
  readonly detection: DetectionState;
  readonly fault: CameraFault | null;
  readonly capturing: boolean;
  readonly capture: () => Promise<DocumentCapture | null>;
}

/** Longest side of the canvas the preview detector looks at. */
const DETECTION_SIDE = 720;

/** The reduced side when detection proves slow on this device. */
const SLOW_DETECTION_SIDE = 560;

/** Sustained per-frame detection cost that counts as slow, in milliseconds. */
const SLOW_DETECTION_MS = 110;

/** Detections to average before judging the device slow. */
const SLOW_SAMPLE_COUNT = 8;

/** Preview detection cadence. ~7 Hz reads as live without cooking the phone. */
const DETECT_INTERVAL_MS = 140;

/** Longest side for the capture-time re-detection pass. */
const CAPTURE_DETECTION_SIDE = 1080;

/**
 * Longest side of the perspective-corrected output. Enough for small print
 * and later OCR; conservative against the instance's upload limit, which the
 * kept-photo path must fit under.
 */
const MAX_OUTPUT_SIDE = 2400;

/** JPEG quality for captures; photographs of paper compress well at this. */
const JPEG_QUALITY = 0.92;

/** Corners this close to the edge (normalized) still count as in frame. */
const EDGE_MARGIN = 0.02;

const UNIT: Size = { width: 1, height: 1 };

export function useDocumentCamera(): DocumentCameraHandle {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<ScannerStatus>("searching");
  const [corners, setCorners] = useState<DocumentCorners | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const [detection, setDetection] = useState<DetectionState>("loading");
  const [fault, setFault] = useState<CameraFault | null>(null);
  const [capturing, setCapturing] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<DocumentScannerEngine | null>(null);
  const trackerRef = useRef(new CornerTracker());
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef(false);
  const detectionSideRef = useRef(DETECTION_SIDE);
  const durationsRef = useRef<{ average: number; samples: number }>({
    average: 0,
    samples: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;

    const stopLoop = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };

    const tick = () => {
      timerRef.current = null;
      if (cancelled || document.hidden) return;

      const engine = engineRef.current;
      const element = videoRef.current;
      if (
        engine &&
        element &&
        element.videoWidth > 0 &&
        element.readyState >= element.HAVE_CURRENT_DATA &&
        !processingRef.current
      ) {
        processingRef.current = true;
        try {
          const started = performance.now();
          const canvas = detectionCanvas(element);
          const detected = engine.detect(canvas);
          const frame = { width: canvas.width, height: canvas.height };
          const credible =
            detected !== null && isCredibleDocument(detected, frame)
              ? normalizeCorners(detected, frame)
              : null;
          const state = trackerRef.current.update(
            credible,
            performance.now(),
          );
          setCorners(state.corners);
          // Ready must additionally mean the whole page is in frame — a
          // half-visible page can hold perfectly still.
          const fullyVisible =
            state.corners !== null &&
            isWithinFrame(state.corners, UNIT, EDGE_MARGIN);
          setStatus(
            state.status === "ready" && !fullyVisible
              ? "hold-still"
              : state.status,
          );
          noteDuration(performance.now() - started);
        } finally {
          processingRef.current = false;
        }
      }

      timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
    };

    const startLoop = () => {
      if (timerRef.current === null && !cancelled) {
        timerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
      }
    };

    const detectionCanvas = (element: HTMLVideoElement) => {
      const canvas = (detectionCanvasRef.current ??=
        document.createElement("canvas"));
      const longSide = Math.min(
        detectionSideRef.current,
        Math.max(element.videoWidth, element.videoHeight),
      );
      const scale =
        longSide / Math.max(element.videoWidth, element.videoHeight);
      const width = Math.max(1, Math.round(element.videoWidth * scale));
      const height = Math.max(1, Math.round(element.videoHeight * scale));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas
        .getContext("2d", { willReadFrequently: true })
        ?.drawImage(element, 0, 0, width, height);
      return canvas;
    };

    /**
     * One-way adaptation: a device that sustains slow detections gets a
     * smaller detection canvas rather than a queue. Capture resolution is
     * unaffected.
     */
    const noteDuration = (ms: number) => {
      const record = durationsRef.current;
      record.samples += 1;
      record.average += (ms - record.average) / Math.min(record.samples, 20);
      if (
        record.samples >= SLOW_SAMPLE_COUNT &&
        record.average > SLOW_DETECTION_MS &&
        detectionSideRef.current > SLOW_DETECTION_SIDE
      ) {
        detectionSideRef.current = SLOW_DETECTION_SIDE;
        durationsRef.current = { average: 0, samples: 0 };
      }
    };

    const measureFrame = () => {
      const element = videoRef.current;
      if (element && element.videoWidth > 0) {
        setFrameSize({
          width: element.videoWidth,
          height: element.videoHeight,
        });
      }
    };

    const openStream = async (): Promise<MediaStream> => {
      // The stated size is an aspiration, not an assumption: everything
      // downstream reads the video element's actual dimensions.
      const attempts: MediaStreamConstraints[] = [
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        { audio: false, video: { facingMode: "environment" } },
        { audio: false, video: true },
      ];
      let failure: unknown;
      for (const constraints of attempts) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (error) {
          failure = error;
          // Only constraint problems justify retrying with looser asks; a
          // denial or a missing camera will not improve.
          if (
            !(error instanceof Error) ||
            error.name !== "OverconstrainedError"
          ) {
            break;
          }
        }
      }
      throw failure;
    };

    const startCamera = async () => {
      try {
        const stream = await openStream();
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        stopStream();
        streamRef.current = stream;
        const element = videoRef.current;
        if (element) {
          element.srcObject = stream;
          // playsinline+muted+autoplay lets iOS start it, but an explicit
          // play() covers the PWA returning from background.
          await element.play().catch(() => {});
        }
        if (!cancelled) {
          measureFrame();
          startLoop();
        }
      } catch (failure) {
        if (!cancelled) setFault(faultFor(failure));
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        // iOS pauses or kills camera streams in the background; do not keep
        // detecting stale frames meanwhile.
        stopLoop();
        return;
      }
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track || track.readyState === "ended") {
        // The OS reclaimed the camera while backgrounded. Start over —
        // without stacking a second stream on a healthy first one.
        trackerRef.current.reset();
        void startCamera();
      } else {
        void videoRef.current?.play().catch(() => {});
        startLoop();
      }
    };

    if (!isLiveCameraSupported()) {
      // Decided after mount — never during render — so a server-rendered
      // instance (which has no navigator) hydrates without a mismatch.
      const timer = setTimeout(() => setFault("unavailable"), 0);
      return () => clearTimeout(timer);
    }

    loadDocumentScanner()
      .then((engine) => {
        if (cancelled) return;
        engineRef.current = engine;
        setDetection("ready");
      })
      .catch(() => {
        // The camera keeps working as a plain camera.
        if (!cancelled) setDetection("failed");
      });

    void startCamera();

    video?.addEventListener("loadedmetadata", measureFrame);
    // Rotating the phone changes the frame's dimensions in place; the video
    // element reports it as a resize.
    video?.addEventListener("resize", measureFrame);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      stopLoop();
      stopStream();
      video?.removeEventListener("loadedmetadata", measureFrame);
      video?.removeEventListener("resize", measureFrame);
      document.removeEventListener("visibilitychange", onVisibility);
      if (video) video.srcObject = null;
      detectionCanvasRef.current = null;
    };
  }, []);

  const capture = useCallback(async (): Promise<DocumentCapture | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setFault("captureFailed");
      return null;
    }
    setCapturing(true);
    processingRef.current = true;
    try {
      const full = document.createElement("canvas");
      full.width = video.videoWidth;
      full.height = video.videoHeight;
      // Drawn once, read once — the flag only spares the console a warning.
      const context = full.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setFault("captureFailed");
        return null;
      }
      context.drawImage(video, 0, 0);

      // Re-detect on the frozen frame: the paper or the phone may have moved
      // since the preview loop last looked, up to 150 ms ago. Detection runs
      // reduced for speed; the corners are scaled onto the full frame.
      let documentCorners: DocumentCorners | null = null;
      const engine = engineRef.current;
      if (engine) {
        const scale = Math.min(
          1,
          CAPTURE_DETECTION_SIDE / Math.max(full.width, full.height),
        );
        const reduced = document.createElement("canvas");
        reduced.width = Math.max(1, Math.round(full.width * scale));
        reduced.height = Math.max(1, Math.round(full.height * scale));
        reduced
          .getContext("2d", { willReadFrequently: true })
          ?.drawImage(full, 0, 0, reduced.width, reduced.height);
        const found = engine.detect(reduced);
        if (
          found !== null &&
          isCredibleDocument(found, {
            width: reduced.width,
            height: reduced.height,
          })
        ) {
          documentCorners = scaleCorners(
            normalizeCorners(found, {
              width: reduced.width,
              height: reduced.height,
            }),
            { width: full.width, height: full.height },
          );
        }
      }

      const output =
        documentCorners !== null && engine
          ? engine.extract(full, documentCorners, MAX_OUTPUT_SIDE)
          : full;
      const blob = await toJpeg(output);
      if (!blob) {
        setFault("captureFailed");
        return null;
      }
      const file = new File([blob], `receipt-scan-${Date.now()}.jpg`, {
        type: "image/jpeg",
      });
      return { file, documentDetected: documentCorners !== null };
    } catch {
      setFault("captureFailed");
      return null;
    } finally {
      processingRef.current = false;
      setCapturing(false);
    }
  }, []);

  return {
    videoRef,
    status,
    corners,
    frameSize,
    detection,
    fault,
    capturing,
    capture,
  };
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
}

/** Maps a getUserMedia rejection onto something the UI can explain. */
function faultFor(failure: unknown): CameraFault {
  if (failure instanceof Error) {
    switch (failure.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "denied";
      case "NotFoundError":
      case "OverconstrainedError":
        return "notFound";
      default:
        return "startFailed";
    }
  }
  return "startFailed";
}
