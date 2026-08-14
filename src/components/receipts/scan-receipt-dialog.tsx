"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, ImageIcon, Loader2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatMinorUnits } from "@/components/expenses/expense-form-logic";
import { uploadReceipt } from "@/components/expenses/upload-receipt";
import {
  ReceiptScanner,
  ScanError,
  type ScanProgress,
} from "@/lib/ocr/scanner";
import { parseReceipt } from "@/modules/receipts";
import {
  assignReceipt,
  type ItemAssignment,
  type SharedChargeStrategy,
} from "@/modules/receipts";
import { isLiveCameraSupported } from "@/lib/doc-scan/engine";
import { ItemAssignmentView, type Participant } from "./item-assignment";
import { DocumentCamera } from "./document-camera";
import { ReceiptReview } from "./receipt-review";
import { ScanProgressView } from "./scan-progress";
import { draftItems, draftTotal, toDraft, type ReceiptDraft } from "./draft";

/**
 * Scan a receipt, correct it, decide who had what, and hand the result to the
 * expense form.
 *
 * The dialog owns the whole flow and produces exactly one thing: a
 * `ScannedExpense`, which is a set of values for fields the expense form
 * already has. It never creates an expense itself — the form still submits,
 * the server still recomputes the split, and everything a scanned expense goes
 * through is what a hand-typed one goes through.
 *
 * The image never leaves the device as part of scanning. It is uploaded only
 * if the user ticks the box asking for it to be kept, and then through the
 * ordinary attachment endpoint. The copy on screen says so in those terms.
 *
 * The two file inputs sit outside the dialog rather than in it, so a caller
 * that already knows which one it wants — the add-entry card, whose Camera and
 * Upload buttons say exactly that — can fire one straight from the page. The
 * dialog then opens on the scan already running, instead of on a second screen
 * asking the same question again.
 */

/**
 * Firing one of the pickers directly, without the capture screen first.
 *
 * A component rather than a callback, so a caller can be a plain function of
 * these two props and be handed to `trigger` by name — see `ScanCard`.
 */
export interface CaptureActions {
  /** The device camera, on hardware that has one. */
  readonly camera: () => void;
  /** The platform's own file picker. */
  readonly upload: () => void;
}

export interface ScannedExpense {
  readonly description: string;
  readonly date: string;
  readonly currency: string;
  /** Major-unit text, ready for the amount field. */
  readonly amount: string;
  /** Per participant, major-unit text for an exact split. */
  readonly splitValues: Readonly<Record<string, string>>;
  readonly participantIds: readonly string[];
  /** Set when the user chose to keep the photograph with the expense. */
  readonly attachmentId?: string;
}

type Step = "capture" | "camera" | "scanning" | "review" | "assign";

export function ScanReceiptDialog({
  groupId,
  participants,
  defaultCurrency,
  onApply,
  trigger,
}: {
  groupId: string;
  participants: readonly Participant[];
  defaultCurrency: string;
  onApply: (result: ScannedExpense) => void;
  /**
   * Replaces the default "Scan a receipt" button. It is rendered with the two
   * pickers as props, so it can open one itself rather than opening the dialog.
   */
  trigger?: React.ComponentType<CaptureActions>;
}) {
  const t = useTranslations("receiptScanner");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("capture");
  const [progress, setProgress] = useState<ScanProgress>({
    stage: "preparing",
  });
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [assignments, setAssignments] = useState<readonly ItemAssignment[]>([]);
  const [strategy, setStrategy] =
    useState<SharedChargeStrategy>("proportional");
  const [keepImage, setKeepImage] = useState(false);
  const [applying, setApplying] = useState(false);

  const scannerRef = useRef<ReceiptScanner | null>(null);
  const fileRef = useRef<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  /** Two ONNX sessions are hundreds of megabytes; do not keep them around. */
  const release = useCallback(() => {
    scannerRef.current?.dispose();
    scannerRef.current = null;
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    fileRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  const reset = () => {
    setStep("capture");
    setDraft(null);
    setAssignments([]);
    setStrategy("proportional");
    setKeepImage(false);
    setError(null);
    release();
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  /**
   * Turns a scan failure into something the reader can act on.
   *
   * Inside the component so `t` keeps its key types; see the same note in
   * `receipt-review.tsx`.
   */
  const messageFor = (failure: unknown): string => {
    const code = failure instanceof ScanError ? failure.code : "runtime";
    switch (code) {
      case "unsupported":
        return t("errors.unsupported");
      case "modelDownload":
        return t("errors.modelDownload");
      case "image":
        return t("errors.image");
      case "timeout":
        return t("errors.timeout");
      default:
        return t("errors.runtime");
    }
  };

  const scan = async (file: File) => {
    setError(null);
    setStep("scanning");
    setProgress({ stage: "preparing" });

    fileRef.current = file;
    const url = URL.createObjectURL(file);
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });

    scannerRef.current ??= new ReceiptScanner();

    try {
      const result = await scannerRef.current.scan(file, setProgress);
      const parsed = parseReceipt(result, {
        fallbackCurrency: defaultCurrency,
      });

      if (parsed.items.length === 0 && parsed.total === undefined) {
        setError(t("errors.nothingFound"));
        setStep("capture");
        return;
      }

      setDraft(
        toDraft(parsed, {
          fallbackCurrency: defaultCurrency,
          fallbackDate: new Date().toISOString().slice(0, 10),
        }),
      );
      setStep("review");
    } catch (failure) {
      setError(messageFor(failure));
      setStep("capture");
    }
  };

  /**
   * A file arrived, from whichever picker.
   *
   * Opening the dialog here rather than through `onOpenChange` matters: that
   * path resets the flow, which would throw away the scan it was opened for.
   */
  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setOpen(true);
    void scan(file);
  };

  /**
   * The live scanner where it can run; the platform's camera picker where it
   * cannot. Opening the dialog directly on the camera step — not through
   * `onOpenChange`, which resets — mirrors how `onFile` opens on a running
   * scan.
   */
  const openCamera = () => {
    if (isLiveCameraSupported()) {
      setError(null);
      setStep("camera");
      setOpen(true);
    } else {
      cameraInput.current?.click();
    }
  };
  const openUpload = () => libraryInput.current?.click();

  const total = draft ? draftTotal(draft) : null;

  const apply = async () => {
    if (!draft || total === null) return;
    setApplying(true);

    try {
      let attachmentId: string | undefined;
      if (keepImage && fileRef.current) {
        const uploaded = await uploadReceipt(
          groupId,
          fileRef.current,
          fileRef.current.name,
        );
        if (uploaded.ok) {
          attachmentId = uploaded.file.id;
        } else {
          // The expense is still worth creating; say the photograph did not
          // make it rather than losing the whole scan.
          setError(t("errors.attachFailed"));
        }
      }

      const assignment = assignReceipt({
        items: draftItems(draft).map((item) => ({
          id: item.id,
          name: item.name,
          total: item.total,
        })),
        assignments,
        participantIds: participants.map((participant) => participant.id),
        total,
        strategy,
      });

      const owing = assignment.shares.filter((share) => share.amount !== 0n);
      const shares = owing.length > 0 ? owing : assignment.shares;

      onApply({
        description: draft.merchant.trim(),
        date: draft.date,
        currency: draft.currency,
        amount: formatMinorUnits(total.toString(), draft.currency),
        splitValues: Object.fromEntries(
          shares.map((share) => [
            share.participantId,
            formatMinorUnits(share.amount.toString(), draft.currency),
          ]),
        ),
        participantIds: shares.map((share) => share.participantId),
        attachmentId,
      });

      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  };

  const Trigger = trigger;

  return (
    <>
      {Trigger && <Trigger camera={openCamera} upload={openUpload} />}

      <Dialog open={open} onOpenChange={onOpenChange}>
        {!Trigger && (
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              <ScanLine aria-hidden="true" />
              {t("scanReceipt")}
            </Button>
          </DialogTrigger>
        )}

        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("onDevice")}</DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {step === "capture" && (
            <CaptureStep
              camera={openCamera}
              upload={openUpload}
              onDropped={(file) => void scan(file)}
            />
          )}

          {step === "camera" && (
            <DocumentCamera
              onCapture={(file) => void scan(file)}
              onFallback={() => {
                setStep("capture");
                cameraInput.current?.click();
              }}
              onCancel={() => setStep("capture")}
            />
          )}

          {step === "scanning" && <ScanProgressView progress={progress} />}

          {step === "review" && draft && (
            <ReceiptReview
              draft={draft}
              onChange={setDraft}
              imageUrl={imageUrl ?? undefined}
            />
          )}

          {step === "assign" && draft && total !== null && (
            <ItemAssignmentView
              draft={draft}
              participants={participants}
              assignments={assignments}
              onAssignmentsChange={setAssignments}
              strategy={strategy}
              onStrategyChange={setStrategy}
              total={total}
            />
          )}

          {(step === "review" || step === "assign") && (
            <div className="flex items-start gap-2 rounded-lg border p-3">
              <Checkbox
                id="keep-receipt-image"
                checked={keepImage}
                onCheckedChange={(checked) => setKeepImage(checked === true)}
              />
              <div className="space-y-1">
                <Label htmlFor="keep-receipt-image" className="font-normal">
                  {t("keepImage")}
                </Label>
                {/* The one distinction this feature must not blur: recognition
                  is local, storage is not. */}
                <p className="text-xs text-muted-foreground">
                  {keepImage ? t("keepImageOn") : t("keepImageOff")}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {step === "review" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("capture")}
                >
                  {t("anotherPhoto")}
                </Button>
                <Button
                  type="button"
                  disabled={total === null}
                  onClick={() => setStep("assign")}
                >
                  {t("continue")}
                </Button>
              </>
            )}

            {step === "assign" && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("review")}
                >
                  {t("back")}
                </Button>
                <Button
                  type="button"
                  onClick={() => void apply()}
                  disabled={applying}
                >
                  {applying && (
                    <Loader2 aria-hidden="true" className="animate-spin" />
                  )}
                  {t("useReceipt")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Outside the dialog, so a trigger can fire either one while it is
          still closed. */}
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onFile}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={libraryInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="sr-only"
        onChange={onFile}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}

function CaptureStep({
  camera,
  upload,
  onDropped,
}: CaptureActions & {
  onDropped: (file: File) => void;
}) {
  const t = useTranslations("receiptScanner");
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file?.type.startsWith("image/")) onDropped(file);
      }}
      className={`space-y-4 rounded-lg border border-dashed p-6 text-center transition-colors ${
        dragging ? "border-primary bg-muted" : ""
      }`}
    >
      <div className="flex flex-col justify-center gap-2 sm:flex-row">
        {/* A mouse has no camera behind it: on a fine pointer the button would
            open a picker that says "no camera available", so it is not there. */}
        <Button
          type="button"
          className="hidden pointer-coarse:inline-flex"
          onClick={camera}
        >
          <Camera aria-hidden="true" />
          {t("takePhoto")}
        </Button>
        <Button type="button" variant="outline" onClick={upload}>
          <ImageIcon aria-hidden="true" />
          {t("choosePhoto")}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{t("tips")}</p>
    </div>
  );
}
