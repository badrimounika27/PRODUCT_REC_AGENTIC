/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        display: ["Outfit", "system-ui", "sans-serif"],
      },
      colors: {
        surface: {
          DEFAULT: "#0c0f14",
          card: "#12171f",
          raised: "#1a2130",
          border: "#2a3344",
        },
        accent: {
          DEFAULT: "#3b82f6",
          dim: "#2563eb",
        },
        mint: "#34d399",
        amber: "#fbbf24",
      },
    },
  },
  plugins: [],
};
