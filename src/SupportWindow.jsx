import { useEffect, useRef, useState } from "react";

function formatMsgTime(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export default function SupportWindow() {
  const api = typeof window !== "undefined" ? window.api : null;
  const scrollRef = useRef(null);
  /** Worker yangilangan bo‘lsa tarix yuklanganida KV tozalanadi — eski serverlar uchun faqat bir marta client ack */
  const didLifecycleAckRef = useRef(false);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [skippedDemo, setSkippedDemo] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      if (!api?.supportFetchHistory) {
        setError("Bu oyna faqat E-Savdo Electron dasturidan ochiladi.");
        return;
      }
      const r = await api.supportFetchHistory();
      if (cancelled) return;
      if (r.skipped) {
        setSkippedDemo(true);
        setMessages([]);
        setNote("Litsenziya demo rejimi — yozishma chiqmaydi.");
        return;
      }
      if (!r.ok) {
        if (r.error === "worker_not_configured") {
          setError("Litsenziya serveri URL sozlanmagan.");
        } else if (r.error === "no_license") {
          setError("Faol obuna bo‘lsa support ochiladi.");
        } else {
          setError(
            r.error === "network" ? "Internet yoki server bilan aloqa yo'q." : "Ma'lumotlarni yuklab bo'lmadi."
          );
        }
        return;
      }
      setError("");
      setMessages(Array.isArray(r.messages) ? r.messages : []);
      const u = Number(r.unreadByUser || 0) || 0;
      setNote(u > 0 ? "Yangi javoblarni ko‘ribsiz." : "");
      if (!didLifecycleAckRef.current && typeof api?.supportAckStaffUnread === "function") {
        didLifecycleAckRef.current = true;
        await api.supportAckStaffUnread();
      }
      if (typeof api?.supportRefreshMainBadge === "function") {
        await api.supportRefreshMainBadge();
      }
    }

    refresh();
    const interval = window.setInterval(() => void refresh(), 12000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (typeof api?.supportAckStaffUnread === "function") {
        void api.supportAckStaffUnread();
      }
    };
  }, [api]);

  async function handleSubmit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || skippedDemo || !api?.supportSendMessage) return;
    setBusy(true);
    setError("");
    const r = await api.supportSendMessage(text);
    setBusy(false);
    if (!r.ok) {
      const msg =
        r.message ||
        (r.error === "rate_limit"
          ? "So‘rov cheklandi. Ozgina kuting."
          : r.error === "skipped"
            ? "Demo rejimida xabar yuborib bo‘lmaydi."
            : "Xabar yuborilmadi.");
      setError(msg);
      return;
    }
    setInput("");
    const again = await api.supportFetchHistory();
    if (again.ok && Array.isArray(again.messages)) {
      setMessages(again.messages);
    }
    if (again?.ok && typeof api?.supportRefreshMainBadge === "function") {
      await api.supportRefreshMainBadge();
    }
  }

  return (
    <div className="support-app">
      <header className="support-app-header">
        <h1 className="support-app-title">Support</h1>
        <p className="support-app-sub">Texnik yordam va savollar</p>
      </header>

      {error ? (
        <div className="support-app-banner support-app-banner--error" role="alert">
          {error}
        </div>
      ) : null}

      {note ? (
        <div className="support-app-banner support-app-banner--info" role="status">
          {note}
        </div>
      ) : null}

      <div className="support-app-messages" ref={scrollRef} aria-live="polite">
        {messages.length === 0 && !error ? (
          <p className="support-app-empty">
            Salom — savolingizni yozing; javob Telegram admin orqali beriladi.
          </p>
        ) : null}

        {messages.map((msg) => {
          const staff = msg.role === "staff";
          return (
            <div key={msg.id} className={`support-app-row ${staff ? "is-staff" : "is-user"}`}>
              <div className={`support-app-bubble ${staff ? "is-staff" : "is-user"}`}>
                <p className="support-app-bubble-text">{msg.body}</p>
                <time className="support-app-bubble-time">{formatMsgTime(msg.ts)}</time>
              </div>
            </div>
          );
        })}
      </div>

      <form className="support-app-composer" onSubmit={handleSubmit}>
        <textarea
          className="support-app-input"
          rows={2}
          placeholder="Xabaringizni yozing…"
          value={input}
          disabled={busy || skippedDemo || !!error}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
        />
        <button
          type="submit"
          className="support-app-send btn"
          disabled={busy || skippedDemo || !!error || !input.trim()}
        >
          Yuborish
        </button>
      </form>
    </div>
  );
}
