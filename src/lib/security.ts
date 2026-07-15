// أدوات الأمان المشتركة: سياسة كلمة السر + إعدادات قفل الدخول

export const PASSWORD_MIN = 8;

export type PasswordPolicy = {
  passwordMinLength?: number;
  passwordRequireLetters?: boolean;
  passwordRequireNumbers?: boolean;
  passwordRequireSymbols?: boolean;
};

// يرجّع رسالة الخطأ إن كانت كلمة السر ضعيفة، أو null إذا سليمة
export function passwordError(pw: string, policy?: PasswordPolicy): string | null {
  const min = Math.max(PASSWORD_MIN, Math.min(64, Number(policy?.passwordMinLength) || PASSWORD_MIN));
  if (!pw || pw.length < min) return `كلمة السر يجب ${min} أحرف على الأقل`;
  const hasLetter = /[A-Za-z\u0600-\u06FF]/.test(pw); // حروف لاتينية أو عربية
  const hasDigit = /[0-9]/.test(pw);
  if (policy?.passwordRequireLetters !== false && !hasLetter) return "كلمة السر يجب أن تحتوي حروفاً";
  if (policy?.passwordRequireNumbers !== false && !hasDigit) return "كلمة السر يجب أن تحتوي أرقاماً";
  if (policy?.passwordRequireSymbols && !/[^\p{L}\p{N}\s]/u.test(pw)) return "كلمة السر يجب أن تحتوي رمزاً خاصاً";
  return null;
}

// حد محاولات الدخول الفاشلة قبل القفل، ومدة القفل
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;
