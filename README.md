# Quark web bridge for Goldleaf

A Nuxt/Vue WebUSB client that exposes a browser-selected `.nsp` file or folder of `.nsp` files as the Goldleaf **Remote PC** filesystem. The UI uses Una UI with its UnoCSS-powered Nuxt module.

## Run

```sh
npm install
npm run dev
```

Open the local URL in Chrome or Edge. Choose an NSP file or folder of NSPs, or open **Advanced: add an NSP URL** to use a direct remote link. Then connect the console over USB, open Goldleaf, and select **Explore → Remote PC → Browser workspace**.

For a production static build:

```sh
npm run generate
npm run preview
```

The browser workspace is mounted at `web:/`, a virtual root name used only by Goldleaf’s file browser—not a URL or a folder on disk. When Goldleaf sends **Select file from PC**, the page opens the NSP file picker. Choose an NSP and the bridge exposes it to Goldleaf for the install flow; canceling the picker cancels the request.

Remote URLs are fetched on demand as Goldleaf requests byte ranges, so the full NSP is not saved locally first. The remote server must allow CORS and HTTP byte-range requests.

This MVP lets Goldleaf browse and read the selected NSP files. It does not let Goldleaf create, change, or rename files on your computer. If Goldleaf asks to delete an installed source NSP, the request is acknowledged but the local file is kept. Selected files stay in the tab and cross only the USB link to Goldleaf; they are not uploaded to a server.

## Notes

- WebUSB requires a secure context: `localhost` during development or HTTPS in deployment.
- Goldleaf must already be running on the console.
- The client targets Goldleaf’s USB device (`0x057e:0x3000`) and bulk endpoint 1 in both directions.
- GitHub Pages deployment is defined in `.github/workflows/deploy.yml` and runs on `main`.
- Goldleaf itself is GPL-3.0 licensed; review the upstream license before distributing a combined product.
