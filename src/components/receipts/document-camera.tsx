"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, ImageIcon, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  cornerList,
  projectToCover,
  type Size,
} from "@/lib/doc-scan/geometry";
import { useDocumentCamera, type CameraFault } from "./use-document-camera";

/**
 * The live camera view inside the scan dialog: rear-camera video, the
 * detected document's outline, and a shutter.
 *
 * The video is displayed with `object-fit: cover`, so the visible picture is
 * a centred crop of the camera frame — the outline is projected through
 * `projectToCover`, never by multiplying normalized corners by the container
 * size, or it would drift off the paper whenever the aspect ratios differ.
 *
 * When the camera cannot run at all, this component does not imitate one: it
 * explains, and hands over to the platform's own camera via `onFallback` —
 * the same file input that served before live detection existed.
 */

export function DocumentCamera({
  onCapture,
  onFallback,
  onCancel,
}: {
  onCapture: (file: File) => void;
  /** Opens the platform camera picker instead — the pre-existing path. */
  onFallback: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("receiptScanner.camera");
  const {
    videoRef,
    status,
    corners,
    frameSize,
    detection,
    fault,
    capturing,
    capture,
  } = useDocumentCamera();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<Size | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shoot = async () => {
    const result = await capture();
    if (result) onCapture(result.file);
  };

  if (fault !== null && fault !== "captureFailed") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{faultMessage(t, fault)}</AlertDescription>
        </Alert>
        <div className="flex flex-col justify-center gap-2 sm:flex-row">
          <Button type="button" onClick={onFallback}>
            <Camera aria-hidden="true" />
            {t("usePhoneCamera")}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        </div>
      </div>
    );
  }

  const ready = status === "ready";
  const outline =
    corners && frameSize && containerSize
      ? cornerList(corners)
          .map((point) => projectToCover(point, frameSize, containerSize))
          .map((point) => `${point.x},${point.y}`)
          .join(" ")
      : null;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative h-[55svh] w-full overflow-hidden rounded-lg bg-black"
      >
        {/* playsInline is what keeps iOS from hijacking the stream into a
            fullscreen player; muted+autoPlay let it start without a tap. */}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />

        {outline && containerSize && (
          <svg
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
          >
            <polygon
              points={outline}
              strokeWidth={ready ? 3 : 2}
              strokeLinejoin="round"
              className={
                ready
                  ? "fill-primary/20 stroke-primary transition-colors"
                  : "fill-white/10 stroke-white/80 transition-colors"
              }
            />
          </svg>
        )}

        <p
          aria-live="polite"
          className="absolute inset-x-0 bottom-3 px-4 text-center text-sm font-medium text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.8)]"
        >
          {hint(t, status, detection, frameSize !== null)}
        </p>
      </div>

      {fault === "captureFailed" && (
        <Alert variant="destructive">
          <AlertDescription>{t("errors.captureFailed")}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-3 items-center">
        <Button
          type="button"
          variant="ghost"
          className="justify-self-start"
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
        <Button
          type="button"
          size="icon"
          aria-label={t("capture")}
          disabled={capturing || frameSize === null}
          onClick={() => void shoot()}
          className="size-14 justify-self-center rounded-full"
        >
          {capturing ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Camera aria-hidden="true" className="size-6" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("choosePhotoInstead")}
          className="justify-self-end"
          onClick={onFallback}
        >
          <ImageIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

type CameraCopy = ReturnType<typeof useTranslations<"receiptScanner.camera">>;

function hint(
  t: CameraCopy,
  status: "searching" | "detected" | "hold-still" | "ready",
  detection: "loading" | "ready" | "failed",
  cameraRunning: boolean,
): string {
  if (!cameraRunning) return t("starting");
  // Without the engine there is nothing to hint about; the shutter still
  // takes a plain photograph.
  if (detection === "failed") return t("manual");
  if (detection === "loading") return t("preparingDetection");
  switch (status) {
    case "searching":
      return t("searching");
    case "detected":
      return t("detected");
    case "hold-still":
      return t("holdStill");
    case "ready":
      return t("ready");
  }
}

function faultMessage(
  t: CameraCopy,
  fault: Exclude<CameraFault, "captureFailed">,
): string {
  switch (fault) {
    case "unavailable":
      return t("errors.unavailable");
    case "denied":
      return t("errors.denied");
    case "notFound":
      return t("errors.notFound");
    case "startFailed":
      return t("errors.startFailed");
  }
}
