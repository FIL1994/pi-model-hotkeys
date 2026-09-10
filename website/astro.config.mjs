import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Set SITE_URL and BASE_PATH for subdirectory deployments such as GitHub Pages.
  site: process.env.SITE_URL,
  base: process.env.BASE_PATH || "/",
  integrations: [
    starlight({
      title: "Pi Model Hotkeys",
      description: "Your favorite models. One keystroke away. Documentation for Pi Model Hotkeys.",
      favicon: "/favicon.svg",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/FIL1994/pi-model-hotkeys" },
      ],
      customCss: ["./src/styles/custom.css"],
      components: {
        ThemeProvider: "./src/components/ThemeProvider.astro",
        ThemeSelect: "./src/components/ThemeSelect.astro",
      },
      editLink: { baseUrl: "https://github.com/FIL1994/pi-model-hotkeys/edit/main/website/" },
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Introduction", slug: "guides/introduction" },
            { label: "Installation", slug: "guides/installation" },
            { label: "Your first shortcuts", slug: "guides/shortcuts" },
          ],
        },
        {
          label: "Make it yours",
          items: [
            { label: "Thinking & model picker", slug: "guides/thinking" },
            { label: "Legend & appearance", slug: "guides/legend" },
            { label: "Modifiers & mouse wheel", slug: "guides/controls" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Troubleshooting", slug: "reference/troubleshooting" },
          ],
        },
      ],
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
