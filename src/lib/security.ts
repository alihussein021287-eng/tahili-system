// أدوات الأمان المشتركة: سياسة كلمة السر + إعدادات قفل الدخول

export const PASSWORD_MIN = 8;

// يرجّع رسالة الخطأ إن كانت كلمة السر ضعيفة، أو null إذا سليمة
export function passwordError(pw: string): string | null {
  if (!pw || pw.length < PASSWORD_MIN) return `كلمة السر يجب ${PASSWORD_MIN} أحرف على الأقل`;
  const hasLetter = /[A-Za-z\u0600-\u06FF]/.test(pw); // حروف لاتينية أو عربية
  const hasDigit = /[0-9]/.test(pw);
  if (!hasLetter || !hasDigit) return "كلمة السر يجب أن تحتوي حروفاً وأرقاماً معاً";
  return null;
}

// حد محاولات الدخول الفاشلة قبل القفل، ومدة القفل
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;
