// Must run before Excalidraw loads: fonts and translations come from StoreFlow
// itself (copied by vite.config.ts), not from a CDN.
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/'

export {}
