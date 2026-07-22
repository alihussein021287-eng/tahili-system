"use client";
import { type FormEvent, useState } from "react";
import { signIn } from "next-auth/react";
import { checkUsername, activateAccount } from "./actions";
import { useRouter } from "next/navigation";

/* أيقونات SVG محلية (بدون أي مصدر خارجي) */
const I = {
  user: "M16 14a4 4 0 10-8 0M12 7a3 3 0 100 6 3 3 0 000-6zM5 20a7 7 0 0114 0",
  calendar: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
  bed: "M3 18V8m0 4h18M21 18v-4a3 3 0 00-3-3H10v3M3 18h18M7 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  wallet: "M3 7a2 2 0 012-2h12a2 2 0 012 2v1M3 7v10a2 2 0 002 2h14a2 2 0 002-2v-6H7a2 2 0 010-4h14M16 13h.01",
  box: "M3.3 7L12 3l8.7 4M3.3 7v10L12 21m-8.7-14L12 11m0 10l8.7-4V7M12 11l8.7-4M12 11v10",
  wrench: "M14.5 6.5a3.5 3.5 0 01-4.6 4.6L5 16l3 3 4.9-4.9a3.5 3.5 0 014.6-4.6l-2 2-1.8-1.8 2-2z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  pulse: "M3 12h4l2-6 4 12 2-6h6",
  qr: "M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h3m3 0h-1m-5-3v3m6-3v6m-3-6h.01M17 20h.01",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
};
function Ico({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CAPS: [keyof typeof I, string, string][] = [
  ["user", "المراجعون", "ملفات وسجل سريري"],
  ["calendar", "المواعيد والطابور", "جدولة ولوحة حيّة"],
  ["bed", "الرقود والأسرّة", "إشغال ومتابعة"],
  ["wallet", "المالية والوصولات", "فواتير وتقارير"],
  ["box", "المخزون الدوائي", "كميات وتنبيهات"],
  ["wrench", "التسليم والصيانة", "أجهزة ومواعيد صيانة"],
  ["chart", "التحليلات والتقارير", "رسوم وإحصاء"],
  ["pulse", "المقاييس والخطط", "متابعة التقدّم العلاجي"],
  ["qr", "بوابة المريض", "رابط و QR وتأكيد موعد"],
  ["shield", "الأمان والنسخ", "صلاحيات وتدقيق ونسخ"],
];

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"user" | "password" | "activate">("user");
  const [username, setUsername] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function continueUser() {
    if (loading) return;
    if (!username.trim()) { setError("اكتب اسم المستخدم"); return; }
    setLoading(true); setError("");
    try {
      const r = await checkUsername(username.trim());
      if (r.state === "invalid") { setError("اسم المستخدم غير موجود أو الحساب معطّل. تحقق من الاسم أو راجع مدير النظام."); return; }
      setShow(false);
      setStep(r.state === "activate" ? "activate" : "password");
    } catch {
      setError("تعذّر التحقق من الحساب. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (loading) return;
    setLoading(true); setError("");
    try {
      const res = await signIn("credentials", { username, password, redirect: false });
      if (res?.error) setError("كلمة السر غير صحيحة");
      else router.push("/");
    } catch {
      setError("تعذّر تسجيل الدخول. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  async function activate() {
    if (loading) return;
    if (password !== confirm) { setError("كلمتا السر غير متطابقتين"); return; }
    setLoading(true); setError("");
    try {
      const r = await activateAccount(username.trim(), temporaryPassword, password, confirm);
      if (!r.ok) { setError(r.error || "تعذّر التفعيل. تحقق من البيانات وحاول مرة أخرى."); return; }
      const res = await signIn("credentials", { username, password, redirect: false });
      if (res?.error) { setError("تم التفعيل. سجّل الدخول بكلمة السر الجديدة."); setStep("password"); setPassword(""); }
      else router.push("/");
    } catch {
      setError("تعذّر تفعيل الحساب. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  function back() { setStep("user"); setTemporaryPassword(""); setPassword(""); setConfirm(""); setShow(false); setError(""); }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "user") void continueUser();
    else if (step === "password") void submit();
    else void activate();
  }

  return (
    <div className="lp-root">
      <style>{`
        .lp-root{min-height:100vh;display:flex;background:#f4f9f8;font-family:Tajawal,'Segoe UI',Tahoma,system-ui,sans-serif;color:#1e293b}
        .lp-brand{position:relative;flex:1.15;overflow:hidden;color:#eafffb;
          background:radial-gradient(120% 90% at 85% 0%,#13746b 0%,#0a4f49 45%,#073d38 100%)}
        .lp-brand-in{position:relative;z-index:2;display:flex;flex-direction:column;height:100%;padding:3.2rem 3rem}
        .lp-grid-bg{position:absolute;inset:0;z-index:1;opacity:.5;
          background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);
          background-size:34px 34px;-webkit-mask-image:radial-gradient(80% 80% at 70% 20%,#000 30%,transparent 100%);mask-image:radial-gradient(80% 80% at 70% 20%,#000 30%,transparent 100%)}
        .lp-pulse{position:absolute;bottom:0;left:0;right:0;z-index:1;opacity:.5}
        .lp-pulse path{stroke:#5eead4;stroke-width:2;fill:none;stroke-dasharray:1400;stroke-dashoffset:1400;animation:lp-draw 5.5s ease-in-out infinite}
        @keyframes lp-draw{0%{stroke-dashoffset:1400}55%{stroke-dashoffset:0}100%{stroke-dashoffset:-1400}}
        @media (prefers-reduced-motion:reduce){.lp-pulse path{animation:none;stroke-dashoffset:0}*{scroll-behavior:auto!important}}
        .lp-logo{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;
          background:linear-gradient(135deg,#2dd4bf,#0f766e);box-shadow:0 8px 24px rgba(0,0,0,.25);font-size:26px;font-weight:800;color:#fff}
        .lp-caps{display:grid;grid-template-columns:1fr 1fr;gap:.7rem;margin:1.6rem 0}
        .lp-cap{display:flex;gap:.7rem;align-items:flex-start;padding:.7rem .8rem;border-radius:14px;
          background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09)}
        .lp-cap-i{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;
          background:rgba(94,234,212,.15);color:#7defd9}
        .lp-pill{display:inline-block;padding:.28rem .7rem;border-radius:999px;font-size:.72rem;
          background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);color:#cdeee8}
        .lp-trust{display:flex;flex-wrap:wrap;gap:.5rem .9rem;font-size:.82rem;color:#bfeae3}
        .lp-trust b{color:#7defd9}
        .lp-form{flex:.85;display:flex;align-items:center;justify-content:center;padding:2rem}
        .lp-card{width:100%;max-width:380px}
        .lp-field{margin-bottom:1rem}
        .lp-label{display:block;font-size:.85rem;font-weight:600;color:#475569;margin-bottom:.35rem}
        .lp-inwrap{position:relative;display:flex;align-items:center}
        .lp-input{width:100%;padding:.7rem .9rem;border:1px solid #d6e2df;border-radius:12px;font-size:.95rem;
          background:#fff;color:#1e293b;outline:none;transition:border-color .15s,box-shadow .15s;font-family:inherit}
        .lp-input:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.15)}
        .lp-eye{position:absolute;inset-inline-start:.6rem;background:none;border:0;color:#94a3b8;cursor:pointer;padding:.25rem;display:flex}
        .lp-eye:hover{color:#0f766e}
        .lp-btn{width:100%;padding:.8rem;border:0;border-radius:12px;font-size:.98rem;font-weight:700;color:#fff;cursor:pointer;
          background:linear-gradient(135deg,#0f766e,#0a4f49);box-shadow:0 6px 18px rgba(10,79,73,.28);transition:filter .15s,transform .05s;font-family:inherit}
        .lp-btn:hover{filter:brightness(1.07)}
        .lp-btn:active{transform:translateY(1px)}
        .lp-btn:disabled{opacity:.65;cursor:default}
        .lp-err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:.6rem .8rem;border-radius:10px;font-size:.85rem;margin-bottom:1rem}
        .lp-back{background:none;border:0;color:#0f766e;font-size:.82rem;margin-top:.8rem;cursor:pointer;font-family:inherit}
        @media (max-width:860px){
          .lp-root{flex-direction:column}
          .lp-brand{flex:none}
          .lp-brand-in{padding:2rem 1.4rem}
          .lp-caps{gap:.5rem;margin:1.1rem 0}
          .lp-cap-sub{display:none}
          .lp-form{flex:1}
        }
        @media (max-width:560px){ .lp-caps{display:none} .lp-updates{display:none} }
        @media (prefers-reduced-motion:reduce){ .lp-pulse path{animation:none;stroke-dashoffset:0} }
        .lp-input:focus-visible,.lp-btn:focus-visible,.lp-eye:focus-visible,.lp-back:focus-visible{outline:2px solid #0f766e;outline-offset:2px}
      `}</style>

      <aside className="lp-brand">
        <div className="lp-grid-bg" />
        <svg className="lp-pulse" viewBox="0 0 800 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,70 L150,70 L180,70 L200,30 L230,100 L260,55 L290,70 L520,70 L545,70 L565,28 L595,104 L625,60 L650,70 L800,70" />
        </svg>
        <div className="lp-brand-in">
          <div style={{ display: "flex", alignItems: "center", gap: ".9rem" }}>
            <div className="lp-logo">ت</div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.2 }}>نظام المجمع التأهيلي</div>
              <div style={{ fontSize: ".9rem", color: "#9fded5" }}>منصّة متكاملة لإدارة المراجعين والمسارات العلاجية والمالية</div>
            </div>
          </div>

          <div className="lp-caps">
            {CAPS.map(([k, t, s]) => (
              <div className="lp-cap" key={t}>
                <span className="lp-cap-i"><Ico d={I[k]} size={18} /></span>
                <span>
                  <span style={{ display: "block", fontWeight: 700, fontSize: ".92rem" }}>{t}</span>
                  <span className="lp-cap-sub" style={{ display: "block", fontSize: ".75rem", color: "#9fded5" }}>{s}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="lp-updates" style={{ marginBottom: "1.1rem" }}>
            <div style={{ fontSize: ".8rem", color: "#9fded5", marginBottom: ".5rem" }}>أحدث ما أُضيف:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: ".4rem" }}>
              {["لوحة تحكم ذكية", "طابور المراجعين", "إدارة الأسرّة", "مقاييس التقدّم", "خطة علاجية", "تقرير مالي سنوي", "بحث شامل", "تأكيد الموعد"].map((p) => (
                <span className="lp-pill" key={p}>{p}</span>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "auto", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,.1)" }}>
            <div className="lp-trust">
              <span><b>●</b> يعمل بدون إنترنت</span>
              <span><b>●</b> صلاحيات وسجل تدقيق</span>
              <span><b>●</b> نسخ احتياطي يومي</span>
              <span><b>●</b> واجهة عربية على الهاتف</span>
            </div>
            <div style={{ fontSize: ".72rem", color: "#7fcabf", marginTop: ".8rem" }}>V3، يعمل محلياً داخل المركز</div>
          </div>
        </div>
      </aside>

      <main className="lp-form">
        <div className="lp-card">
          <div style={{ marginBottom: "1.6rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 800, color: "#0a4f49", margin: 0 }}>تسجيل الدخول</h1>
            <p style={{ fontSize: ".9rem", color: "#64748b", marginTop: ".3rem" }}>
              {step === "user" && "اكتب اسم المستخدم للمتابعة."}
              {step === "password" && "أدخل كلمة السر للمتابعة."}
              {step === "activate" && "أثبت كلمة المرور المؤقتة ثم عيّن كلمة سر جديدة."}
            </p>
          </div>

          {error ? <div id="login-error" className="lp-err" aria-live="polite">{error}</div> : null}

          <form onSubmit={handleSubmit} aria-describedby={error ? "login-error" : undefined}>
            <div className="lp-field">
              <label className="lp-label" htmlFor="u">اسم المستخدم</label>
              <input id="u" name="username" className="lp-input" value={username} disabled={step !== "user" || loading}
                autoComplete="username" spellCheck={false} enterKeyHint="next"
                aria-invalid={Boolean(error) && step === "user"}
                onChange={(e) => setUsername(e.target.value)} />
            </div>

            {step === "password" ? (
              <div className="lp-field">
                <label className="lp-label" htmlFor="p">كلمة السر</label>
                <div className="lp-inwrap">
                  <input id="p" name="password" className="lp-input" type={show ? "text" : "password"} value={password}
                    autoComplete="current-password" aria-invalid={Boolean(error)}
                    onChange={(e) => setPassword(e.target.value)} style={{ paddingInlineStart: "2.4rem" }} />
                  <button type="button" className="lp-eye" onClick={() => setShow((v) => !v)}
                    aria-label={show ? "إخفاء كلمة السر" : "إظهار كلمة السر"} aria-pressed={show}>
                    <Ico d={show ? "M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9 9 0 0121 12a13 13 0 01-1.7 2.4M6.3 6.3A13 13 0 003 12a9 9 0 0010.5 6.6" : "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z"} size={18} />
                  </button>
                </div>
              </div>
            ) : null}

            {step === "activate" ? (
              <>
                <div className="lp-field">
                  <label className="lp-label" htmlFor="pt">كلمة المرور المؤقتة</label>
                  <input id="pt" name="temporaryPassword" className="lp-input" type={show ? "text" : "password"} value={temporaryPassword}
                    autoComplete="current-password" aria-invalid={Boolean(error)}
                    onChange={(e) => setTemporaryPassword(e.target.value)} />
                </div>
                <div className="lp-field">
                  <label className="lp-label" htmlFor="p1">كلمة السر الجديدة</label>
                  <input id="p1" name="newPassword" className="lp-input" type={show ? "text" : "password"} value={password}
                    autoComplete="new-password" aria-describedby="password-requirements" aria-invalid={Boolean(error)}
                    onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="lp-field">
                  <label className="lp-label" htmlFor="p2">تأكيد كلمة السر</label>
                  <input id="p2" name="confirmPassword" className="lp-input" type={show ? "text" : "password"} value={confirm}
                    autoComplete="new-password" aria-describedby="password-requirements" aria-invalid={Boolean(error)}
                    onChange={(e) => setConfirm(e.target.value)} />
                </div>
                <p id="password-requirements" style={{ fontSize: ".72rem", color: "#94a3b8", marginTop: "-.4rem", marginBottom: ".6rem" }}>
                  استخدم 8 أحرف على الأقل، تشمل حروفاً وأرقاماً.
                </p>
              </>
            ) : null}

            {step === "user" ? <button type="submit" className="lp-btn" disabled={loading}>{loading ? "جارٍ التحقق…" : "متابعة"}</button> : null}
            {step === "password" ? <button type="submit" className="lp-btn" disabled={loading}>{loading ? "جارٍ الدخول…" : "دخول"}</button> : null}
            {step === "activate" ? <button type="submit" className="lp-btn" disabled={loading}>{loading ? "جارٍ التفعيل…" : "تفعيل وتسجيل الدخول"}</button> : null}

            {step !== "user" ? (
              <button type="button" className="lp-back" onClick={back}>
                رجوع لاستخدام اسم مستخدم آخر
              </button>
            ) : null}
          </form>

          <p style={{ fontSize: ".78rem", color: "#94a3b8", marginTop: "1.2rem", textAlign: "center" }}>
            للحصول على حساب أو استعادة كلمة السر، راجع مدير النظام.
          </p>
        </div>
      </main>
    </div>
  );
}
