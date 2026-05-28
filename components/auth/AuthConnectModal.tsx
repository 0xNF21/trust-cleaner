"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, X } from "lucide-react";

import { useAuthSession } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { writeClientAuthToken } from "@/lib/client-auth-token";

type Step =
  | { kind: "idle" }
  | { kind: "loading_challenge" }
  | { kind: "miniapp_signing" }
  | { kind: "miniapp_verifying" }
  | {
      kind: "standalone_waiting";
      challengeId: number;
      nonce: string;
      verifyToken: string;
      paymentLink: string;
      qrCode: string;
    }
  | { kind: "success"; refundStatus?: string | null }
  | { kind: "error"; message: string };

type PendingChallenge = {
  challengeId: number;
  nonce: string;
  verifyToken: string;
  paymentLink: string;
  qrCode: string;
  expiresAt: number;
};

const PENDING_AUTH_KEY = "trust_cleaner_pending_auth";

function loadPendingChallenge(): PendingChallenge | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingChallenge;
    if (!parsed?.challengeId || !parsed.verifyToken) return null;
    if (Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(PENDING_AUTH_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePendingChallenge(challenge: PendingChallenge) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(challenge));
  } catch {}
}

function clearPendingChallenge() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(PENDING_AUTH_KEY);
  } catch {}
}

export function AuthConnectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { address, isMiniappHost } = useWallet();
  const { refresh } = useAuthSession();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [copied, setCopied] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      cancelledRef.current = false;
      return;
    }

    cancelledRef.current = false;
    if (isMiniappHost) void runMiniAppFlow();
    else void runStandaloneFlow();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function runMiniAppFlow() {
    if (!address) {
      setStep({ kind: "error", message: "No Circles wallet injected by the host." });
      return;
    }

    setStep({ kind: "loading_challenge" });

    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "miniapp_sign_message",
          origin: "miniapp",
          expectedAddress: address,
        }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok || !challengeData?.challengeId) {
        throw new Error(challengeData?.error ?? "challenge_failed");
      }

      if (cancelledRef.current) return;
      setStep({ kind: "miniapp_signing" });

      const { signMessage } = await import("@aboutcircles/miniapp-sdk");
      const signature = await signMessage(challengeData.message, "erc1271");

      if (cancelledRef.current) return;
      setStep({ kind: "miniapp_verifying" });

      const verifyRes = await fetch("/api/auth/verify-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          challengeId: challengeData.challengeId,
          signature: signature.signature,
          address,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData?.authenticated) {
        throw new Error(verifyData?.error ?? "verify_failed");
      }

      writeClientAuthToken(verifyData.sessionToken);
      await refresh();
      if (cancelledRef.current) return;
      setStep({ kind: "success" });
      setTimeout(() => {
        if (!cancelledRef.current) onClose();
      }, 900);
    } catch (error) {
      if (cancelledRef.current) return;
      setStep({
        kind: "error",
        message: error instanceof Error ? error.message : "Authentication failed.",
      });
    }
  }

  async function runStandaloneFlow() {
    const pending = loadPendingChallenge();
    if (pending) {
      const state: Step = {
        kind: "standalone_waiting",
        challengeId: pending.challengeId,
        nonce: pending.nonce,
        verifyToken: pending.verifyToken,
        paymentLink: pending.paymentLink,
        qrCode: pending.qrCode,
      };
      setStep(state);
      pollPayment(state);
      return;
    }

    setStep({ kind: "loading_challenge" });

    try {
      const challengeRes = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "payment_1crc", origin: "standalone" }),
      });
      const challengeData = await challengeRes.json();
      if (!challengeRes.ok || !challengeData?.challengeId) {
        throw new Error(challengeData?.error ?? "challenge_failed");
      }
      if (!challengeData.verifyToken) throw new Error("missing_verify_token");

      const expiresAt = challengeData.expiresAt
        ? new Date(challengeData.expiresAt).getTime()
        : Date.now() + 30 * 60 * 1000;

      savePendingChallenge({
        challengeId: challengeData.challengeId,
        nonce: challengeData.nonce,
        verifyToken: challengeData.verifyToken,
        paymentLink: challengeData.paymentLink,
        qrCode: challengeData.qrCode,
        expiresAt,
      });

      const state: Step = {
        kind: "standalone_waiting",
        challengeId: challengeData.challengeId,
        nonce: challengeData.nonce,
        verifyToken: challengeData.verifyToken,
        paymentLink: challengeData.paymentLink,
        qrCode: challengeData.qrCode,
      };
      setStep(state);
      pollPayment(state);
    } catch (error) {
      if (cancelledRef.current) return;
      setStep({
        kind: "error",
        message: error instanceof Error ? error.message : "Authentication failed.",
      });
    }
  }

  function pollPayment(prev: Extract<Step, { kind: "standalone_waiting" }>) {
    const tick = async () => {
      if (cancelledRef.current) return;

      try {
        const response = await fetch("/api/auth/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            challengeId: prev.challengeId,
            verifyToken: prev.verifyToken,
          }),
        });
        const data = await response.json();

        if (cancelledRef.current) return;
        if (data?.status === "confirmed" || data?.authenticated) {
          clearPendingChallenge();
          writeClientAuthToken(data?.sessionToken);
          await refresh();
          setStep({
            kind: "success",
            refundStatus: data?.refund?.status ?? null,
          });
          setTimeout(() => {
            if (!cancelledRef.current) onClose();
          }, 1200);
          return;
        }
        if (data?.status === "expired") {
          clearPendingChallenge();
          setStep({ kind: "error", message: "Auth payment challenge expired." });
          return;
        }

        setTimeout(tick, 3000);
      } catch {
        if (!cancelledRef.current) setTimeout(tick, 5000);
      }
    };

    setTimeout(tick, 3000);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm">
      <div className="trust-panel w-full max-w-md rounded-lg p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Authenticate wallet</h2>
            <p className="text-sm text-ink/65">
              {isMiniappHost
                ? "Sign a message with the Circles host."
                : "Pay 1 CRC as ownership proof. It is refunded automatically."}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-ink/60 hover:bg-ink/5 hover:text-ink"
            onClick={onClose}
            aria-label="Close auth modal"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="mt-5 flex min-h-72 flex-col items-center justify-center text-center">
          {step.kind === "loading_challenge" && (
            <Status icon={<Loader2 className="size-8 animate-spin" />} text="Preparing challenge" />
          )}

          {step.kind === "miniapp_signing" && (
            <Status icon={<Loader2 className="size-8 animate-spin" />} text="Approve the signature in Circles" />
          )}

          {step.kind === "miniapp_verifying" && (
            <Status icon={<Loader2 className="size-8 animate-spin" />} text="Verifying signature" />
          )}

          {step.kind === "standalone_waiting" && (
            <div className="flex w-full flex-col items-center gap-4">
              <p className="text-sm text-ink/65">
                Send 1 CRC with the generated auth data. Trust Cleaner will detect the payment and refund it.
              </p>
              {step.qrCode ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={step.qrCode}
                  alt="Auth payment QR code"
                  className="size-56 rounded-lg border border-ink/10 bg-white p-2 shadow-sm"
                />
              ) : null}
              <div className="flex w-full flex-wrap gap-2">
                <Button
                  className="min-w-36 flex-1"
                  render={
                    <a href={step.paymentLink} target="_blank" rel="noreferrer">
                      Open wallet
                    </a>
                  }
                />
                <Button
                  variant="outline"
                  className="border-ink/15 bg-white/70 hover:border-marine/30 hover:bg-white"
                  onClick={async () => {
                    await navigator.clipboard.writeText(step.paymentLink).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  <Copy className="size-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-ink/55">
                Keep this tab open until the refund status is returned.
              </p>
            </div>
          )}

          {step.kind === "success" && (
            <Status
              icon={<Check className="size-8 text-marine" />}
              text={
                step.refundStatus
                  ? `Authenticated. Refund status: ${step.refundStatus}.`
                  : "Authenticated."
              }
            />
          )}

          {step.kind === "error" && (
            <div className="flex flex-col items-center gap-3">
              <AlertTriangle className="size-9 text-citrus" />
              <p className="text-sm font-medium text-ink">Authentication failed</p>
              <p className="text-xs text-ink/60">{step.message}</p>
              <Button onClick={() => (isMiniappHost ? runMiniAppFlow() : runStandaloneFlow())}>
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Status({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-sm text-ink/65">
      {icon}
      <span>{text}</span>
    </div>
  );
}
