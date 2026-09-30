"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Send, X } from "lucide-react";
import {
  Root as Dialog,
  Content as DialogContent,
  Description as DialogDescription,
  Title as DialogTitle,
  Trigger as DialogTrigger,
  Portal as DialogPortal,
  Close as DialogClose,
} from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { AUTH_HINT_CHANGED_EVENT } from "@/lib/auth/hint";

export function SupportChat({ maxQueryLength }: { maxQueryLength: number }) {
  const locale = useLocale();
  const t = useTranslations("support");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const identity = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const [signedIn, setSignedIn] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let checking = false;
    const reset = () => {
      generation.current++;
      controller.current?.abort();
      setMessages([]);
      setConversationId(undefined);
      setQuery("");
      setBusy(false);
    };
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch("/api/support/session", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!active) return;
        if (
          identity.current !== undefined &&
          identity.current !== data.identity
        )
          reset();
        identity.current = data.identity;
        setSignedIn(data.signedIn === true);
      } catch {
        if (active) {
          reset();
          setSignedIn(false);
        }
      } finally {
        checking = false;
      }
    };
    const changed = () => {
      reset();
      void check();
    };
    void check();
    const interval = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    window.addEventListener("storage", changed);
    window.addEventListener(AUTH_HINT_CHANGED_EVENT, changed);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", changed);
      window.removeEventListener(AUTH_HINT_CHANGED_EVENT, changed);
    };
  }, [open]);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, busy, open]);
  async function sendText(value: string) {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setQuery("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    controller.current = new AbortController();
    const current = generation.current;
    try {
      const response = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, conversationId }),
        signal: AbortSignal.any([
          controller.current.signal,
          AbortSignal.timeout(50_000),
        ]),
      });
      if (generation.current !== current) return;
      if (response.status === 409) {
        setMessages([]);
        setConversationId(undefined);
        throw new Error(t("expired"));
      }
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(
          response.status === 429
            ? t(failure.error === "budget_exhausted" ? "budget" : "limited")
            : t("error"),
        );
      }
      const data = await response.json();
      if (generation.current !== current) return;
      if (
        typeof data.answer !== "string" ||
        typeof data.conversationId !== "string"
      )
        throw new Error(t("error"));
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer },
      ]);
    } catch (e) {
      if (generation.current !== current) return;
      setError(
        e instanceof Error &&
          [t("limited"), t("budget"), t("expired")].includes(e.message)
          ? e.message
          : t("error"),
      );
      setQuery(text);
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen} modal={false}>
      <DialogTrigger asChild>
        <Button className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40 rounded-full shadow-lg">
          <MessageCircle className="mr-2 h-5 w-5" />
          {t("title")}
        </Button>
      </DialogTrigger>
      <DialogPortal>
        <DialogContent
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+3.5rem)] right-4 z-40 flex h-[min(38rem,calc(100dvh-7rem-env(safe-area-inset-bottom)))] w-[calc(100vw-2rem)] flex-col gap-3 rounded-2xl border bg-background p-4 shadow-2xl outline-none sm:right-5 sm:w-96 sm:p-5"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b pb-3">
            <div>
              <DialogTitle className="text-lg font-semibold">
                {t("title")}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-muted-foreground">
                {t("label")}
              </DialogDescription>
            </div>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label={t("close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
          <div
            role="log"
            aria-live="polite"
            aria-label={t("title")}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain py-2"
          >
            {!messages.length && (
              <p className="text-sm text-muted-foreground">{t("intro")}</p>
            )}
            {messages.map((message, i) => (
              <p
                key={i}
                className={`whitespace-pre-wrap break-words rounded-lg p-3 text-sm ${message.role === "user" ? "ml-8 bg-primary text-primary-foreground" : "mr-4 bg-muted"}`}
              >
                {message.text}
              </p>
            ))}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("waiting")}
              </p>
            )}
            <div ref={bottom} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <button
              type="button"
              className="underline"
              disabled={busy}
              onClick={() => void sendText(t("deployments"))}
            >
              {t("deployments")}
            </button>
            <a
              className="underline"
              href={`/${locale}/${signedIn ? "profile" : "signin"}`}
            >
              {signedIn ? t("dashboard") : t("login")}
            </a>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void sendText(query);
            }}
            className="flex gap-2"
          >
            <input
              aria-label={t("placeholder")}
              placeholder={t("placeholder")}
              value={query}
              maxLength={maxQueryLength}
              onChange={(event) => setQuery(event.target.value)}
              disabled={busy}
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-base"
            />
            <Button
              type="submit"
              disabled={busy || !query.trim()}
              aria-label={t("send")}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
          <div className="flex justify-between text-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMessages([]);
                setConversationId(undefined);
                setError("");
                setQuery("");
              }}
              className="underline disabled:opacity-50"
            >
              {t("reset")}
            </button>
            <a className="underline" href="mailto:support@clawsimple.com">
              {t("email")}
            </a>
          </div>
          <p className="text-xs text-muted-foreground">{t("notice")}</p>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
