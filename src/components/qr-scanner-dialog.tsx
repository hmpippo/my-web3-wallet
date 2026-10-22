"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

interface QrScannerDialogProps {
  /** Closes the dialog. Camera tracks are stopped before this fires. */
  onClose: () => void;
  /** Receives the raw text of the first decoded QR code. */
  onScan: (value: string) => void;
  /** Validation message shown inside the dialog while scanning continues. */
  errorMessage?: string | null;
  /** Dialog heading. Defaults to the send-form wording. */
  title?: string;
}

type CameraStatus = "starting" | "scanning" | "error";

/** Decoding faster than this burns battery without making scans feel quicker. */
const DECODE_INTERVAL_MS = 120;
/** Frames are downscaled to this edge before decoding to keep phones responsive. */
const MAX_DECODE_EDGE = 640;

/**
 * Full-screen camera dialog that resolves a QR code to text.
 *
 * The component is mounted only while open, so the camera starts on mount and
 * every track is stopped on unmount. The decoder runs locally on a throttled
 * requestAnimationFrame loop; no frame ever leaves the device.
 */
export function QrScannerDialog({
  onClose,
  onScan,
  errorMessage,
  title = "Scan recipient QR code",
}: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onScanRef = useRef(onScan);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Keep the callback fresh without restarting the decode loop on every render.
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Move focus into the dialog, lock background scrolling, and restore both on
  // close so keyboard users land back on the Scan button.
  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    function stopCamera() {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const stream = streamRef.current;
      streamRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    }

    function readFrame(video: HTMLVideoElement): string | null {
      if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
        return null;
      }
      const scale = Math.min(
        1,
        MAX_DECODE_EDGE / Math.max(video.videoWidth, video.videoHeight),
      );
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));

      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvasRef.current = canvas;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(video, 0, 0, width, height);

      let image: ImageData;
      try {
        image = context.getImageData(0, 0, width, height);
      } catch {
        // A tainted canvas is impossible for camera frames, but a failure here
        // must never break the dialog.
        return null;
      }
      return (
        jsQR(image.data, width, height, { inversionAttempts: "dontInvert" })
          ?.data ?? null
      );
    }

    function startDecoding() {
      const video = videoRef.current;
      if (!video) return;
      let lastDecode = 0;

      const tick = (now: number) => {
        if (cancelled) return;
        frameRef.current = requestAnimationFrame(tick);
        if (now - lastDecode < DECODE_INTERVAL_MS) return;
        lastDecode = now;

        const value = readFrame(video);
        if (!value) return;
        // Do not stop the camera here: the parent may reject the payload and
        // keep the dialog open, in which case the user should be able to scan a
        // different code immediately. Unmounting the dialog stops the tracks.
        onScanRef.current(value);
      };

      frameRef.current = requestAnimationFrame(tick);
    }

    async function startCamera() {
      setStatus("starting");
      setCameraError(null);

      if (!window.isSecureContext) {
        setStatus("error");
        setCameraError(
          "Camera scanning needs a secure (HTTPS) connection. Type or paste the address instead.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setCameraError(
          "This browser can't access the camera. Type or paste the address instead.",
        );
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (caught) {
        if (cancelled) return;
        // A desktop webcam may not report an environment-facing camera, so the
        // constrained request can fail even though a usable camera exists.
        if (!isConstraintFailure(caught)) {
          setStatus("error");
          setCameraError(describeCameraError(caught));
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch (retryError) {
          if (cancelled) return;
          setStatus("error");
          setCameraError(describeCameraError(retryError));
          return;
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        return;
      }

      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // `autoPlay` may already have started playback; decoding still works.
      }
      if (cancelled) {
        stopCamera();
        return;
      }

      setStatus("scanning");
      startDecoding();
    }

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [attempt]);

  return (
    <div
      className="scanner-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="scanner-heading"
        aria-modal="true"
        className="scanner-panel"
        role="dialog"
      >
        <div className="scanner-header">
          <h2 id="scanner-heading">{title}</h2>
          <button
            aria-label="Close QR scanner"
            className="scanner-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="scanner-viewport">
          <video
            autoPlay
            className="scanner-video"
            muted
            playsInline
            ref={videoRef}
          />
          {status === "scanning" ? (
            <div className="scanner-frame" aria-hidden="true" />
          ) : null}
          {status !== "scanning" ? (
            <div
              className="scanner-status"
              role={status === "error" ? "alert" : "status"}
            >
              <p>
                {status === "starting"
                  ? "Starting camera..."
                  : (cameraError ??
                    "The camera couldn't be started. Type or paste the address instead.")}
              </p>
              {status === "error" ? (
                <button
                  className="button button-outline scanner-retry"
                  onClick={() => setAttempt((value) => value + 1)}
                  type="button"
                >
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="field-help scanner-help">
          Hold the code steady inside the frame. Frames are decoded on this
          device and never uploaded.
        </p>
        {status === "scanning" ? (
          <p className="scanner-live" role="status">
            Looking for a QR code...
          </p>
        ) : null}
        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** Constraint failures mean "try again with a generic camera request". */
function isConstraintFailure(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "OverconstrainedError" ||
      error.name === "ConstraintNotSatisfiedError")
  );
}

function describeCameraError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
      case "SecurityError":
        return "Camera access was blocked. Allow camera access for this site in your browser settings, then try again — or type the address instead.";
      case "NotFoundError":
      case "DevicesNotFoundError":
      case "OverconstrainedError":
        return "No camera was found on this device. Type or paste the address instead.";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera is in use by another app. Close it, then try again — or type the address instead.";
      default:
        break;
    }
  }
  return "The camera couldn't be started. Type or paste the address instead.";
}
