"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinorUnits } from "@/components/expenses/expense-form-logic";
import { uploadReceipt } from "@/components/expenses/upload-receipt";
import {
  createReader,
  ScanError,
  type ReaderKind,
  type ReceiptReader,
  type ScanProgress,
} from "@/lib/ocr/reader";
import {
  assignReceipt,
  type ItemAssignment,
  type SharedChargeStrategy,
} from "@/modules/receipts";
import { isLiveCameraSupported } from "@/lib/doc-scan/engine";
import { looksLikePdf } from "@/lib/pdf/read-pdf";
import { recordReceiptScanAction } from "@/modules/telemetry/actions";
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
 * dialog then opens on the scan already running.
 *
 * There is no screen here that asks camera-or-file. There used to be, and
 * every way of reaching it was a dead end: it opened on a question the two
 * buttons on the card had already answered, and it was also where the flow
 * dumped you when the camera was cancelled or a scan came back with nothing —
 * a modal offering the choice you had just made, in front of the form you were
 * trying to get back to. Cancelling now closes the dialog, and a scan that
 * fails says so in a toast over the form rather than in a dialog of its own.
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

/**
 * Where the flow is.
 *
 * Every one of these is a screen worth being in front of. The dialog is only
 * ever opened onto one of them — the camera, or a scan already running — so
 * there is no resting state to fall back to and no initial value that is ever
 * rendered.
 */
type Step = "camera" | "scanning" | "review" | "assign";

export function ScanReceiptDialog({
  groupId,
  participants,
  defaultCurrency,
  onApply,
  trigger,
  localAvailable,
  provider,
}: {
  groupId: string;
  /** Whether the on-device reader can run here. */
  localAvailable: boolean;
  /** The configured server-side reader, named, or undefined for none. */
  provider?: string;
  participants: readonly Participant[];
  defaultCurrency: string;
  onApply: (result: ScannedExpense) => void;
  /**
   * Replaces the default pair of buttons. It is rendered with the two pickers
   * as props, and like the default pair it opens one of them itself — nothing
   * opens this dialog except a receipt on its way in.
   */
  trigger?: React.ComponentType<CaptureActions>;
}) {
  const t = useTranslations("receiptScanner");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("scanning");
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

  /**
   * Which reader to use.
   *
   * On this device wherever that is possible, because it is the only reader
   * that promises the photograph goes nowhere. An instance with no models
   * installed has only the provider, and starts on it.
   */
  const [readerKind, setReaderKind] = useState<ReaderKind>(
    localAvailable ? "local" : "remote",
  );

  const readerRef = useRef<ReceiptReader | null>(null);
  const fileRef = useRef<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  /** Whether what was scanned was a document rather than a photograph. */
  const [isPdf, setIsPdf] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  /** Which picker produced what is on screen, so "another photo" reopens it. */
  const lastPicker = useRef<"camera" | "library">("library");

  /** Two ONNX sessions are hundreds of megabytes; do not keep them around. */
  const release = useCallback(() => {
    readerRef.current?.dispose();
    readerRef.current = null;
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    fileRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  const reset = () => {
    setStep("scanning");
    setDraft(null);
    setAssignments([]);
    setStrategy("proportional");
    setKeepImage(false);
    setIsPdf(false);
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
      case "pdfPassword":
        return t("errors.pdfPassword");
      case "pdf":
        return t("errors.pdf");
      case "timeout":
        return t("errors.timeout");
      case "provider":
        return t("errors.provider");
      default:
        return t("errors.runtime");
    }
  };

  /**
   * Tells the server that a scan happened, and how it went.
   *
   * One word from a list of three — never the image, the text, the merchant or
   * the total, none of which leaves this device at any point. The server drops
   * it unless telemetry is switched on, which it is not by default; the call is
   * made either way so that the page does not have to be told whether this
   * instance is recording. Failures are ignored on purpose: a counter is not
   * worth an error message in front of somebody reading a receipt.
   */
  const recordScan = (outcome: "recognised" | "empty" | "failed") =>
    recordReceiptScanAction(outcome).catch(() => undefined);

  /**
   * A scan that produced nothing usable.
   *
   * The dialog goes away and the reason is said over the form, because there
   * is nothing left in here to look at — and the form is where the two
   * buttons that start another attempt are.
   */
  const giveUp = (message: string) => {
    toast.error(message);
    onOpenChange(false);
  };

  const scan = async (file: File, kind: ReaderKind = readerKind) => {
    setError(null);
    setStep("scanning");
    setProgress({ stage: "preparing" });

    fileRef.current = file;

    // A PDF has no picture to hold up beside the values, so the review screen
    // is given none rather than an <img> pointed at a document.
    const pdf = await looksLikePdf(file);
    setIsPdf(pdf);
    const url = pdf ? null : URL.createObjectURL(file);
    setImageUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });

    // A reader is built per scan rather than per dialog: switching between
    // them mid-session has to release whatever the last one was holding.
    readerRef.current?.dispose();
    readerRef.current = createReader(kind, {
      groupId,
      fallbackCurrency: defaultCurrency,
    });

    try {
      const parsed = await readerRef.current.read(file, setProgress);

      if (parsed.items.length === 0 && parsed.total === undefined) {
        // Advice about framing and light is no help to someone holding a PDF.
        giveUp(pdf ? t("errors.nothingFoundPdf") : t("errors.nothingFound"));
        void recordScan("empty");
        return;
      }

      setDraft(
        toDraft(parsed, {
          fallbackCurrency: defaultCurrency,
          fallbackDate: new Date().toISOString().slice(0, 10),
        }),
      );
      setStep("review");
      void recordScan("recognised");
    } catch (failure) {
      giveUp(messageFor(failure));
      void recordScan("failed");
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
    lastPicker.current = "camera";
    if (isLiveCameraSupported()) {
      setError(null);
      setStep("camera");
      setOpen(true);
    } else {
      cameraInput.current?.click();
    }
  };

  const openUpload = () => {
    lastPicker.current = "library";
    libraryInput.current?.click();
  };

  /**
   * Another go at the same receipt, from wherever this one came from.
   *
   * The reader asked for a photograph a moment ago and does not need asking
   * again — reopening the picker they used is the whole of "try another".
   */
  const retry = () => {
    if (lastPicker.current === "camera") {
      openCamera();
    } else {
      openUpload();
    }
  };

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
      {Trigger ? (
        <Trigger camera={openCamera} upload={openUpload} />
      ) : (
        /* The plain pair, for a caller that brings no card of its own. Each
           opens its own picker, the way the card's two do — nothing here
           opens the dialog by itself, because the dialog has nothing to show
           until there is a receipt to read. */
        <div className="flex flex-col gap-2 sm:flex-row">
          {/* A mouse has no camera behind it: on a fine pointer this would
              open a picker that says "no camera available". */}
          <Button
            type="button"
            variant="outline"
            className="hidden pointer-coarse:inline-flex"
            onClick={openCamera}
          >
            <Camera aria-hidden="true" />
            {t("takePhoto")}
          </Button>
          <Button type="button" variant="outline" onClick={openUpload}>
            <ScanLine aria-hidden="true" />
            {t("choosePhoto")}
          </Button>
        </div>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {readerKind === "local"
                ? t("onDevice")
                : t("reader.remoteExplain", { provider: provider ?? "" })}
            </DialogDescription>
          </DialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/*
           * The choice, offered only where there is one. An instance with a
           * provider and no models has nothing to ask about, and the header
           * above has already said where the photograph is going.
           *
           * It sits on the review screen because that is where the reason to
           * change it appears: the other reader is worth trying when this one
           * has just misread something, not before it has read anything. So
           * changing it re-reads the receipt already in hand.
           */}
          {step === "review" && localAvailable && provider !== undefined && (
            <RadioGroup
              value={readerKind}
              onValueChange={(value) => {
                const next = value as ReaderKind;
                setReaderKind(next);
                if (fileRef.current) void scan(fileRef.current, next);
              }}
              className="gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="local" id="reader-local" />
                <Label htmlFor="reader-local" className="font-normal">
                  {t("reader.local")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="remote" id="reader-remote" />
                <Label htmlFor="reader-remote" className="font-normal">
                  {t("reader.remote", { provider })}
                </Label>
              </div>
            </RadioGroup>
          )}

          {step === "camera" && (
            <DocumentCamera
              onCapture={(file) => void scan(file)}
              onFallback={() => {
                // Closing first: the platform picker is what carries on from
                // here, and it puts the dialog back itself once it has a file.
                onOpenChange(false);
                cameraInput.current?.click();
              }}
              // Backing out of the camera is backing out of scanning, and what
              // is behind this dialog is the form they were filling in.
              onCancel={() => onOpenChange(false)}
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
                  {isPdf ? t("keepFile") : t("keepImage")}
                </Label>
                {/* The one distinction this feature must not blur: recognition
                  is local, storage is not. */}
                <p className="text-xs text-muted-foreground">
                  {isPdf
                    ? keepImage
                      ? t("keepFileOn")
                      : t("keepFileOff")
                    : keepImage
                      ? t("keepImageOn")
                      : t("keepImageOff")}
                </p>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {step === "review" && (
              <>
                <Button type="button" variant="ghost" onClick={retry}>
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
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
        className="sr-only"
        onChange={onFile}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
