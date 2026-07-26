import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "تسجيل الدخول | المجمع التأهيلي",
  description: "منصة المجمع التأهيلي لتنظيم الرعاية والخدمات المؤسسية.",
};

const services = [
  ["المرضى والرعاية", "ملف موحّد يساند تنظيم الرعاية والمتابعة اليومية."],
  ["الاستشارية الطبية والطبيب المقيم", "تنسيق التقييم الطبي والعمل السريري ضمن الصلاحيات."],
  ["الفحوص والإحالات", "تنظيم طلبات الفحص والإحالة ومتابعة إنجازها."],
  ["العلاج الطبيعي وبرامج المراكز", "متابعة الخطط والبرامج والجلسات التأهيلية."],
  ["الصيدلية والمخزون", "إدارة الوصفات والمواد والحركات المخزنية."],
  ["التقارير والمالية", "تقارير تشغيلية وإجراءات مالية ورسمية مترابطة."],
  ["الموظفون والمهام", "تنظيم فرق العمل والمهام والحضور والمتابعة."],
  ["التعاون والملفات", "مساحة داخلية للتواصل وتبادل الملفات المؤسسية."],
] as const;

const centers = [
  ["مركز العلاج الطبيعي", "برامج علاجية وجلسات متابعة متخصصة."],
  ["مركز التأهيل النفسي", "خدمات تأهيل نفسي ضمن بيئة مؤسسية منضبطة."],
  ["مركز العلاج الوظيفي", "برامج تدعم الاستقلال والمهارات الوظيفية."],
  ["مركز النقاء التخصصي", "مسار تخصصي منسّق ضمن خدمات المجمع."],
] as const;

const journey = [
  "تسجيل المراجع",
  "التقييم الطبي",
  "تحديد المسار والخطة",
  "جدولة الجلسات والخدمات",
  "المتابعة والتقييم",
  "التقارير والإجراءات الرسمية",
] as const;

const operationalFeatures = [
  "صلاحيات حسب الدور",
  "سجل تدقيق",
  "تنبيهات ومتابعة",
  "تعاون وملفات داخلية",
  "دعم الوضع الداكن",
  "تصميم متجاوب",
  "إمكانية العمل داخل الشبكة المحلية",
] as const;

function Icon({ name }: { name: "care" | "link" | "shield" | "network" }) {
  const paths = {
    care: "M12 21s-7-4.35-7-10a4 4 0 017-2.65A4 4 0 0119 11c0 5.65-7 10-7 10z",
    link: "M10 13a5 5 0 007.54.54l2-2a5 5 0 00-7.07-7.07l-1.15 1.15M14 11a5 5 0 00-7.54-.54l-2 2a5 5 0 007.07 7.07l1.15-1.15",
    shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
    network: "M12 5v6m0 0H6m6 0h6M6 11v5m12-5v5M3 19h6v-3H3v3zm12 0h6v-3h-6v3z",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

function safeCallbackUrl(value: string | string[] | undefined) {
  const callback = Array.isArray(value) ? value[0] : value;
  return callback?.startsWith("/") && !callback.startsWith("//") ? callback : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const year = new Intl.DateTimeFormat("ar-IQ", { year: "numeric" }).format(new Date());

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#login-form">تخطَّ إلى تسجيل الدخول</a>

      <header className={styles.header}>
        <div className={styles.shell}>
          <a className={styles.brand} href="#top" aria-label="المجمع التأهيلي - أعلى الصفحة">
            <span className={styles.logo} aria-hidden="true">ت</span>
            <span>
              <strong>المجمع التأهيلي</strong>
              <small>نظام الإدارة والرعاية المتكاملة</small>
            </span>
          </a>
          <nav className={styles.nav} aria-label="التنقل في الصفحة">
            <a href="#about">عن النظام</a>
            <a href="#services">الخدمات</a>
            <a href="#centers">المراكز</a>
            <a href="#workflow">آلية العمل</a>
          </nav>
          <a className={styles.headerLogin} href="#login-form">تسجيل الدخول</a>
        </div>
      </header>

      <main id="top">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`${styles.shell} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>منصة مؤسسية موحّدة</span>
              <h1 id="hero-title">رعاية تأهيلية مترابطة من التسجيل إلى المتابعة</h1>
              <p>منصة موحدة لتنظيم رحلة المراجع، العمل الطبي والعلاجي، المواعيد، الصيدلية، التقارير، والخدمات الإدارية ضمن صلاحيات واضحة.</p>
              <div className={styles.heroActions}>
                <a className={styles.primaryButton} href="#login-form">تسجيل الدخول</a>
                <a className={styles.secondaryButton} href="#services">استعراض خدمات النظام</a>
              </div>
              <div className={styles.localNote}><span aria-hidden="true">●</span> مصمم للعمل المؤسسي داخل شبكة المجمع</div>
            </div>

            <div className={styles.heroSide}>
              <LoginForm callbackUrl={callbackUrl} />
              <div className={styles.journeyGraphic} aria-label="رسم توضيحي عام لترابط رحلة الرعاية">
                {["المراجع", "التقييم", "الخطة العلاجية", "الجلسات", "المتابعة"].map((label, index) => (
                  <div className={styles.journeyNode} key={label}>
                    <span>{index + 1}</span>
                    <small>{label}</small>
                  </div>
                ))}
              </div>
              <p className={styles.graphicNote}>تصوّر توضيحي عام، ولا يمثل حالات العمل الطبية الفعلية.</p>
            </div>
          </div>
        </section>

        <section className={styles.section} id="about" aria-labelledby="about-title">
          <div className={`${styles.shell} ${styles.aboutGrid}`}>
            <div>
              <span className={styles.sectionKicker}>عن النظام</span>
              <h2 id="about-title">مساحة عمل واحدة تربط أقسام المجمع</h2>
              <p className={styles.sectionLead}>يساعد النظام الفرق على الوصول إلى المعلومات والإجراءات التي تحتاجها بوضوح، مع إبقاء المسؤوليات والصلاحيات محددة.</p>
            </div>
            <ul className={styles.checkList}>
              {[
                "ملف مراجع موحد",
                "تنسيق العمل بين الأقسام",
                "متابعة رحلة المراجع",
                "توحيد المواعيد والطابور",
                "حفظ السجلات والصلاحيات والتدقيق",
                "العمل ضمن شبكة المؤسسة",
              ].map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>

        <section className={`${styles.section} ${styles.tinted}`} id="services" aria-labelledby="services-title">
          <div className={styles.shell}>
            <span className={styles.sectionKicker}>الخدمات الرئيسية</span>
            <h2 id="services-title">منظومة تغطي العمل الطبي والتأهيلي والإداري</h2>
            <div className={styles.cardGrid}>
              {services.map(([title, description], index) => (
                <article className={styles.serviceCard} key={title}>
                  <span className={styles.cardNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} id="centers" aria-labelledby="centers-title">
          <div className={styles.shell}>
            <span className={styles.sectionKicker}>المراكز التأهيلية</span>
            <h2 id="centers-title">خدمات تخصصية ضمن إطار عمل مترابط</h2>
            <div className={styles.centerGrid}>
              {centers.map(([title, description]) => (
                <article className={styles.centerCard} key={title}>
                  <span className={styles.iconBox}><Icon name="care" /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.workflowSection}`} id="workflow" aria-labelledby="workflow-title">
          <div className={styles.shell}>
            <span className={styles.sectionKicker}>آلية العمل</span>
            <h2 id="workflow-title">رحلة عامة واضحة من الاستقبال إلى المتابعة</h2>
            <ol className={styles.steps}>
              {journey.map((item, index) => (
                <li key={item}><span>{index + 1}</span><strong>{item}</strong></li>
              ))}
            </ol>
            <p className={styles.workflowNote}>هذا شرح تعريفي عام فقط؛ تبقى المسارات والحالات الطبية محكومة بإجراءات النظام الفعلية.</p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="operations-title">
          <div className={`${styles.shell} ${styles.operationsGrid}`}>
            <div>
              <span className={styles.sectionKicker}>خصائص تشغيلية</span>
              <h2 id="operations-title">تجربة عمل هادئة ومهيأة للمؤسسة</h2>
              <p className={styles.sectionLead}>واجهة عربية متجاوبة تدعم فرق المجمع في الاستخدام اليومي داخل بيئة العمل.</p>
              <div className={styles.featureIcons} aria-hidden="true">
                <span><Icon name="shield" /></span>
                <span><Icon name="link" /></span>
                <span><Icon name="network" /></span>
              </div>
            </div>
            <ul className={styles.featureList}>
              {operationalFeatures.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.shell}>
          <span><strong>المجمع التأهيلي</strong> · للاستخدام المؤسسي المصرح فقط</span>
          <span>© {year}</span>
        </div>
      </footer>
    </div>
  );
}
