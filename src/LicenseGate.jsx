import { useEffect, useRef, useState } from "react";
import LicenseCelebration from "./LicenseCelebration.jsx";

const POLL_MS = 3800;
const CELEBRATION_MS = 3200;

const PLANS = [
  { id: "monthly", label: "Oylik" },
  { id: "quarterly", label: "3 oylik" },
  { id: "semiannual", label: "6 oylik" },
  { id: "yearly", label: "Yillik" }
];

export default function LicenseGate({ licenseInfo, api, onGranted, onNotice }) {
  const [selectedPlan, setSelectedPlan] = useState("monthly");
  const [fullName, setFullName] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastMessage, setLastMessage] = useState("");
  const [waitingPoll, setWaitingPoll] = useState(false);
  const [celebration, setCelebration] = useState(false);
  const [grantPayload, setGrantPayload] = useState(null);
  const pollActiveRef = useRef(false);
  const onGrantedRef = useRef(onGranted);
  onGrantedRef.current = onGranted;

  const machineId = licenseInfo?.machineId || "";
  const workerMissing = licenseInfo?.error === "worker_not_configured";

  async function copyId() {
    if (!machineId) return;
    try {
      await navigator.clipboard.writeText(machineId);
      onNotice?.("Device ID nusxalandi.");
    } catch {
      onNotice?.("Nusxalash muvaffaqiyatsiz.");
    }
  }

  function beginCelebration(s) {
    setGrantPayload(s);
    setCelebration(true);
    setWaitingPoll(false);
    pollActiveRef.current = false;
    onNotice?.("Obunangiz tasdiqlandi!");
  }

  useEffect(() => {
    if (!celebration || !grantPayload) return undefined;
    const id = window.setTimeout(() => {
      onGrantedRef.current(grantPayload);
    }, CELEBRATION_MS);
    return () => window.clearTimeout(id);
  }, [celebration, grantPayload]);

  useEffect(() => {
    if (!waitingPoll || !api?.licenseGetStatus || workerMissing) return undefined;

    async function tick() {
      if (!pollActiveRef.current) return;
      try {
        const s = await api.licenseGetStatus();
        if (s.valid === true || s.skipped === true) {
          pollActiveRef.current = false;
          beginCelebration(s);
        }
      } catch {
        /* keyingi urinish */
      }
    }

    pollActiveRef.current = true;
    const first = window.setTimeout(tick, 1200);
    const interval = window.setInterval(tick, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      pollActiveRef.current = false;
    };
  }, [waitingPoll, api, workerMissing]);

  async function submitRequest(e) {
    e.preventDefault();
    if (!api?.licenseSubmitRequest) return;
    setSubmitting(true);
    setLastMessage("");
    try {
      const res = await api.licenseSubmitRequest({
        plan: selectedPlan,
        fullName: fullName.trim(),
        contact: contact.trim()
      });
      if (res?.ok) {
        setLastMessage(
          "So'rov yuborildi. Admin tasdiqlaguncha avtomatik tekshiramiz — kuting yoki «Litsenziyani tekshirish»."
        );
        onNotice?.("So'rov admin ga yuborildi.");
        if (!workerMissing) setWaitingPoll(true);
      } else {
        const err = res?.error;
        setLastMessage(
          err === "fullName_required"
            ? "Ism va familiyani kiriting."
            : res?.message || err || "Yuborishda xatolik."
        );
      }
    } catch (err) {
      setLastMessage(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function recheck() {
    if (!api?.licenseGetStatus) return;
    setSubmitting(true);
    setLastMessage("");
    try {
      const s = await api.licenseGetStatus();
      if (s.valid === true || s.skipped === true) {
        setSubmitting(false);
        beginCelebration(s);
        return;
      }
      setLastMessage(
        s.error === "worker_not_configured"
          ? "Litsenziya serveri sozlanmagan. Dasturchi bilan bog'laning."
          : s.error === "clock_tamper"
            ? "Vaqtni to'g'rilang va internet bilan tekshiring."
            : "Hali tasdiqlanmagan yoki muddat tugagan. Admin tasdiqlagach qayta urinib ko'ring."
      );
    } catch (err) {
      setLastMessage(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (celebration) {
    return <LicenseCelebration />;
  }

  return (
    <div className="license-gate">
      <div className="license-gate-card">
        <h1 className="license-gate-title">E-Savdo — obuna</h1>
        <p className="license-gate-lead">
          Dasturdan foydalanish uchun obuna bo&apos;ling. So&apos;rovingiz admin ga Telegram orqali
          yuboriladi; tasdiqlangach shu yerdan «Litsenziyani tekshirish» orqali kirish ochiladi.
        </p>

        {workerMissing ? (
          <div className="license-gate-banner license-gate-banner-warn">
            <strong>Server sozlanmagan.</strong> Dastur ishga tushirishda{" "}
            <code>LICENSE_WORKER_URL</code> muhit o&apos;zgaruvchisi berilishi kerak.
          </div>
        ) : null}

        {licenseInfo?.error === "clock_tamper" ? (
          <div className="license-gate-banner license-gate-banner-warn">
            <strong>Vaqtni tekshirish:</strong> Qurilma vaqti ortga surilgan yoki obuna bilan
            bog&apos;langan saqlangan vaqtlar buzilgan. To&apos;g&apos;ri sana va vaqtni sozlang,
            internetga ulaning va «Litsenziyani tekshirish» ni bosing.
          </div>
        ) : null}

        {licenseInfo?.error === "verify_failed" && licenseInfo?.message ? (
          <div className="license-gate-banner license-gate-banner-warn">
            Tekshiruv xatosi: {licenseInfo.message}
          </div>
        ) : null}

        <div className="license-device-row">
          <span className="license-device-label">Device ID</span>
          <code className="license-device-id">{machineId || "—"}</code>
          <button type="button" className="btn secondary license-copy-btn" onClick={() => void copyId()}>
            Nusxalash
          </button>
        </div>

        <form className="license-form" onSubmit={submitRequest}>
          <div className="license-plans">
            {PLANS.map((p) => (
              <label key={p.id} className={`license-plan ${selectedPlan === p.id ? "active" : ""}`}>
                <input
                  type="radio"
                  name="plan"
                  value={p.id}
                  checked={selectedPlan === p.id}
                  onChange={() => setSelectedPlan(p.id)}
                />
                <span>{p.label}</span>
              </label>
            ))}
          </div>

          <label className="license-contact-label">
            Ism va familiya
            <input
              className="input license-contact-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Masalan: Ali Valiyev"
              autoComplete="name"
              required
            />
          </label>

          <label className="license-contact-label">
            Kontakt (telefon yoki Telegram)
            <input
              className="input license-contact-input"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="+998 …"
              autoComplete="tel"
            />
          </label>

          <div className="license-actions">
            <button type="submit" className="btn primary" disabled={submitting || workerMissing}>
              {submitting ? "Yuborilmoqda…" : "Obuna so'rovini yuborish"}
            </button>
            <button type="button" className="btn secondary" onClick={() => void recheck()} disabled={submitting}>
              Litsenziyani tekshirish
            </button>
          </div>
        </form>

        {waitingPoll && !workerMissing ? (
          <p className="license-gate-polling" role="status">
            <span className="license-gate-polling-dot" aria-hidden="true" />
            Avtomatik tekshirilmoqda…
          </p>
        ) : null}

        {lastMessage ? <p className="license-gate-message">{lastMessage}</p> : null}
      </div>
    </div>
  );
}
