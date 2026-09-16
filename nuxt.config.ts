export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },
  modules: ["@una-ui/nuxt"],
  css: ["~/src/styles.css"],
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || "/",
    head: {
      title: "Quark Web Bridge for Goldleaf",
      meta: [
        {
          name: "description",
          content: "A WebUSB bridge for browsing NSP files from Goldleaf on Nintendo Switch.",
        },
        { name: "theme-color", content: "#0a0d0c" },
      ],
    },
  },
  nitro: {
    output: {
      publicDir: "dist",
    },
  },
});
