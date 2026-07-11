import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6f5", 100: "#d6eae7", 200: "#aed6d0", 300: "#7cbcb3",
          400: "#46998f", 500: "#0f766e", 600: "#0d655e", 700: "#0a4f49",
          800: "#08443f", 900: "#073d38",
        },
      },
      fontFamily: { sans: ["IBM Plex Sans Arabic", "Tajawal", "system-ui", "sans-serif"] },
    },
  },
  // ضمان توليد كلاسات الألوان الدلالية المستخدمة عبر @apply في globals.css
  safelist: [
    "bg-emerald-50", "text-emerald-700", "border-emerald-200", "bg-emerald-100", "text-emerald-800",
    "bg-amber-50", "text-amber-700", "border-amber-200", "bg-amber-100", "text-amber-800", "bg-amber-500",
    "bg-red-50", "text-red-700", "border-red-200", "bg-red-100", "text-red-800", "bg-red-600",
    "bg-sky-50", "text-sky-700", "border-sky-200", "text-sky-800",
    "bg-gray-100", "text-gray-600",
  ],
  plugins: [],
};
export default config;
