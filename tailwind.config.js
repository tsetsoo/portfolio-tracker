/**
 * Tailwind v3 (not v4) on purpose: the Raspberry Pi target is armv7 / Debian
 * Buster on Node 18, and v4's engine (@tailwindcss/oxide) requires Node >= 20
 * plus native lightningcss binaries that have no working armv7 build here.
 * v3 is pure JS, so it cross-builds for the Pi without native dependencies.
 *
 * These values are mirrored as CSS custom properties in app/globals.css so
 * ImportWizard.module.css can reference the same tokens.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0a0e14",
        surface: "#111823",
        elevated: "#18202c",
        line: "rgba(255, 255, 255, 0.07)",
        "line-strong": "rgba(255, 255, 255, 0.14)",
        text: "#e6edf5",
        dim: "#8494a6",
        faint: "#5a6878",
        gain: "#3fdd8a",
        loss: "#ff6b6b",
        warn: "#f5b54a",
      },
      borderRadius: {
        card: "14px",
      },
      // v3's default opacity scale is coarser than v4's; these are the extra
      // steps the design uses, for both `opacity-*` and `bg-color/*` modifiers.
      opacity: {
        8: "0.08",
        45: "0.45",
        85: "0.85",
      },
      boxShadow: {
        // The inset top highlight is what makes a dark card read as lit.
        card:
          "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -12px rgba(0, 0, 0, 0.6)",
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
