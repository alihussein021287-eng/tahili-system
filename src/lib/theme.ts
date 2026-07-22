export const THEME_STORAGE_KEY = "tahili-theme";

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEME_PREFERENCES.includes(value as ThemePreference);
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): "light" | "dark" {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference;
}

export const THEME_INIT_SCRIPT = `(()=>{try{const k=${JSON.stringify(THEME_STORAGE_KEY)};const v=localStorage.getItem(k)||localStorage.getItem('theme');const p=v==='light'||v==='dark'||v==='system'?v:'system';if(!localStorage.getItem(k))localStorage.setItem(k,p);const d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);const r=document.documentElement;r.classList.toggle('dark',d);r.dataset.theme=p;r.style.colorScheme=d?'dark':'light'}catch(_){}})();`;
