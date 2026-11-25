import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#1558D6",
          dark: "#0B2E6F",
          pale: "#EAF2FF",
          canvas: "#F5F9FF",
          gold: "#FFC21A",
          sky: "#22B8F0",
          free: "#16A34A",
          occupied: "#94A3B8",
          alert: "#F59E0B",
          error: "#DC2626",
        },
      },
      borderRadius: {
        card: "1.25rem",
      },
      boxShadow: {
        soft: "0 12px 35px rgba(11, 46, 111, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
