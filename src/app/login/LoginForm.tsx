"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { activateAccount, checkUsername } from "./actions";
import styles from "./login.module.css";

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={hidden ? "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z" : "M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9 9 0 0121 12a13 13 0 01-1.7 2.4M6.3 6.3A13 13 0 003 12a9 9 0 0010.5 6.6"} />
    </svg>
  );
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
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
      const res = await signIn("credentials", { username, password, redirect: false, callbackUrl });
      if (res?.error) setError("كلمة السر غير صحيحة");
      else router.push(callbackUrl);
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
      const res = await signIn("credentials", { username, password, redirect: false, callbackUrl });
      if (res?.error) { setError("تم التفعيل. سجّل الدخول بكلمة السر الجديدة."); setStep("password"); setPassword(""); }
      else router.push(callbackUrl);
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
    <section className={styles.loginCard} id="login-form" aria-labelledby="login-title">
      <div className={styles.loginHeading}>
        <span className={styles.status}><i aria-hidden="true" /> بوابة الموظفين</span>
        <h2 id="login-title">تسجيل الدخول</h2>
        <p>
          {step === "user" && "أدخل بيانات حسابك الوظيفي للمتابعة."}
          {step === "password" && "أدخل كلمة السر للمتابعة."}
          {step === "activate" && "أثبت كلمة المرور المؤقتة ثم عيّن كلمة سر جديدة."}
        </p>
      </div>

      {error ? <div id="login-error" className={styles.error} role="alert" aria-live="polite">{error}</div> : null}

      <form onSubmit={handleSubmit} aria-describedby={error ? "login-error" : undefined}>
        <div className={styles.field}>
          <label htmlFor="u">اسم المستخدم</label>
          <input id="u" name="username" value={username} disabled={step !== "user" || loading}
            autoComplete="username" spellCheck={false} enterKeyHint="next"
            aria-invalid={Boolean(error) && step === "user"}
            onChange={(event) => setUsername(event.target.value)} />
        </div>

        {step === "password" ? (
          <div className={styles.field}>
            <label htmlFor="p">كلمة السر</label>
            <div className={styles.inputWrap}>
              <input id="p" name="password" type={show ? "text" : "password"} value={password}
                autoComplete="current-password" aria-invalid={Boolean(error)}
                onChange={(event) => setPassword(event.target.value)} />
              <button type="button" className={styles.eye} onClick={() => setShow((value) => !value)}
                aria-label={show ? "إخفاء كلمة السر" : "إظهار كلمة السر"} aria-pressed={show}>
                <EyeIcon hidden={!show} />
              </button>
            </div>
          </div>
        ) : null}

        {step === "activate" ? (
          <>
            <div className={styles.field}>
              <label htmlFor="pt">كلمة المرور المؤقتة</label>
              <input id="pt" name="temporaryPassword" type={show ? "text" : "password"} value={temporaryPassword}
                autoComplete="current-password" aria-invalid={Boolean(error)}
                onChange={(event) => setTemporaryPassword(event.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="p1">كلمة السر الجديدة</label>
              <input id="p1" name="newPassword" type={show ? "text" : "password"} value={password}
                autoComplete="new-password" aria-describedby="password-requirements" aria-invalid={Boolean(error)}
                onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="p2">تأكيد كلمة السر</label>
              <input id="p2" name="confirmPassword" type={show ? "text" : "password"} value={confirm}
                autoComplete="new-password" aria-describedby="password-requirements" aria-invalid={Boolean(error)}
                onChange={(event) => setConfirm(event.target.value)} />
            </div>
            <p id="password-requirements" className={styles.requirements}>استخدم 8 أحرف على الأقل، تشمل حروفاً وأرقاماً.</p>
          </>
        ) : null}

        {step === "user" ? <button type="submit" className={styles.submit} disabled={loading}>{loading ? "جارٍ التحقق…" : "متابعة"}</button> : null}
        {step === "password" ? <button type="submit" className={styles.submit} disabled={loading}>{loading ? "جارٍ الدخول…" : "دخول"}</button> : null}
        {step === "activate" ? <button type="submit" className={styles.submit} disabled={loading}>{loading ? "جارٍ التفعيل…" : "تفعيل وتسجيل الدخول"}</button> : null}

        {step !== "user" ? <button type="button" className={styles.back} onClick={back}>رجوع لاستخدام اسم مستخدم آخر</button> : null}
      </form>

      <p className={styles.help}>راجع مدير النظام إذا تعذّر الدخول أو احتجت إلى استعادة كلمة السر.</p>
    </section>
  );
}
