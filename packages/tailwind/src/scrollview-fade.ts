import plugin from "tailwindcss/plugin";

export default plugin(function scrollviewFadePlugin({
  addUtilities,
  matchUtilities,
  theme,
  addBase,
}) {
  matchUtilities(
    {
      "scrollview-fade-x": (value) => ({
        "--fade-angle": "90deg",
        "--fade-size": value,
        "--fade-axis": "x",
      }),
      "scrollview-fade-y": (value) => ({
        "--fade-angle": "180deg",
        "--fade-size": value,
        "--fade-axis": "y",
      }),
    },
    {
      supportsNegativeValues: false,
      values: theme("spacing"),
      type: ["length", "percentage"],
    }
  );

  addBase({
    "@property --fade-start-opacity": {
      syntax: '"<number>"',
      initialValue: "1",
      inherits: "false",
    },
    "@property --fade-end-opacity": {
      syntax: '"<number>"',
      initialValue: "1",
      inherits: "false",
    },
  });

  addUtilities({
    ".scrollview-fade": {
      position: "relative",
      scrollTimeline: "--scroll-timeline var(--fade-axis)",
      "--fade-start-opacity": "1",
      "--fade-end-opacity": "1",
      maskImage: `
          linear-gradient(var(--fade-angle), 
            hsl(0 0% 0% / var(--fade-start-opacity)), 
            black var(--fade-size), 
            black calc(100% - var(--fade-size)), 
            hsl(0 0% 0% / var(--fade-end-opacity))
          )
        `,
      WebkitMaskImage: `
          linear-gradient(var(--fade-angle), 
            hsl(0 0% 0% / var(--fade-start-opacity)), 
            black var(--fade-size), 
            black calc(100% - var(--fade-size)), 
            hsl(0 0% 0% / var(--fade-end-opacity))
          )
        `,
      animation:
        "scrollview-fade-start 10s ease-out both, scrollview-fade-end 10s ease-out both",
      animationTimeline: "--scroll-timeline, --scroll-timeline",
      animationRange: "0 2em, calc(100% - 2em) 100%",
    },
    "@keyframes scrollview-fade-start": {
      from: { "--fade-start-opacity": "1" },
      to: { "--fade-start-opacity": "0" },
    },
    "@keyframes scrollview-fade-end": {
      from: { "--fade-end-opacity": "0" },
      to: { "--fade-end-opacity": "1" },
    },
  });
});
