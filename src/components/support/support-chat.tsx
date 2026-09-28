"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const copy = {
  en: {
    title: "ClawSimple Support",
    label: "AI assistant",
    intro: "Questions about setup, plans, or your bot?",
    placeholder: "Your question",
    send: "Send",
    waiting: "Preparing an answer…",
    error: "Chat is unavailable. Please try again or email support.",
    email: "Email support",
    reset: "New conversation",
    notice: "AI answers may be inaccurate. Never share passwords or API keys.",
    limited: "Too many messages. Please wait a minute.",
  },
  "zh-Hans": {
    title: "ClawSimple 客服",
    label: "AI 助手",
    intro: "可以咨询部署、套餐和机器人使用问题。",
    placeholder: "请输入问题",
    send: "发送",
    waiting: "正在回答…",
    error: "客服暂时无法回答，请稍后重试或发邮件联系。",
    email: "邮件联系",
    reset: "新对话",
    notice: "AI 回答可能有误，请勿发送密码或 API 密钥。",
    limited: "消息过于频繁，请稍等一分钟。",
  },
  "zh-Hant": {
    title: "ClawSimple 客服",
    label: "AI 助手",
    intro: "可以詢問部署、方案和機器人使用問題。",
    placeholder: "請輸入問題",
    send: "傳送",
    waiting: "正在回答…",
    error: "客服暫時無法回答，請稍後重試或以郵件聯絡。",
    email: "郵件聯絡",
    reset: "新對話",
    notice: "AI 回答可能有誤，請勿傳送密碼或 API 金鑰。",
    limited: "訊息過於頻繁，請稍等一分鐘。",
  },
  ja: {
    title: "ClawSimple サポート",
    label: "AI アシスタント",
    intro: "設定、プラン、ボットについて質問できます。",
    placeholder: "質問を入力",
    send: "送信",
    waiting: "回答を作成中…",
    error:
      "現在回答できません。再度お試しいただくか、メールでお問い合わせください。",
    email: "メールで問い合わせ",
    reset: "新しい会話",
    notice:
      "AI の回答には誤りが含まれる場合があります。パスワードや API キーを送信しないでください。",
    limited: "メッセージが多すぎます。1 分ほどお待ちください。",
  },
};
export function SupportChat({ locale }: { locale: string }) {
  const t = copy[locale as keyof typeof copy] ?? copy.en;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [conversationId, setConversationId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, busy, open]);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setQuery("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    controller.current = new AbortController();
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
      if (!response.ok)
        throw new Error(response.status === 429 ? t.limited : t.error);
      const data = await response.json();
      if (
        typeof data.answer !== "string" ||
        typeof data.conversationId !== "string"
      )
        throw new Error(t.error);
      setConversationId(data.conversationId);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.answer },
      ]);
    } catch (e) {
      setError(
        e instanceof Error && e.message === t.limited ? t.limited : t.error,
      );
      setQuery(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg">
          <MessageCircle className="mr-2 h-5 w-5" />
          {t.title}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(38rem,85dvh)] w-[calc(100%-2rem)] flex-col gap-3 rounded-xl p-5 sm:max-w-md">
        <div>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription className="mt-1">{t.label}</DialogDescription>
        </div>
        <div
          role="log"
          aria-live="polite"
          aria-label={t.title}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto py-2"
        >
          {!messages.length && (
            <p className="text-sm text-muted-foreground">{t.intro}</p>
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
              {t.waiting}
            </p>
          )}
          <div ref={bottom} />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <form onSubmit={send} className="flex gap-2">
          <input
            aria-label={t.placeholder}
            placeholder={t.placeholder}
            value={query}
            maxLength={2000}
            onChange={(event) => setQuery(event.target.value)}
            disabled={busy}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-base"
          />
          <Button
            type="submit"
            disabled={busy || !query.trim()}
            aria-label={t.send}
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
            {t.reset}
          </button>
          <a className="underline" href="mailto:support@clawsimple.com">
            {t.email}
          </a>
        </div>
        <p className="text-xs text-muted-foreground">{t.notice}</p>
      </DialogContent>
    </Dialog>
  );
}
