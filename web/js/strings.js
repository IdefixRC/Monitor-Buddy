// All user-facing text. The Buddy speaks in first person; buttons and labels stay plain.
export const S = {
  title: "Monitor Buddy flasher",
  unsupported: "I can only be set up from Chrome or Edge on a computer. Open this page there and plug me in with a USB cable.",
  connect: "Connect your Buddy",

  // The face and the device preview (face.js, preview.js).
  faceLabel: "Your Buddy's face",
  previewLabel: "Preview of your Buddy. Select it to show the next page.",
  // Theme names in the firmware's order (settings.theme 0-4, see config.h.example).
  themeNames: ["Classic", "Minimal", "Semantic", "Warm amber", "Cool teal"],
  // Page names in PAGE_KEYS order, shown under the preview.
  pageNames: {
    face: "Face",
    clock: "Clock",
    date: "Date",
    weather: "Weather",
    moon: "Moon",
    stock: "Stock",
    github: "GitHub",
  },
  previewSample: "sample values",
};
