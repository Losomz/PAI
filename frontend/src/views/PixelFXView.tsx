export default function PixelFXView() {
  return (
    <iframe
      title="PixelFX 官方画廊"
      src="pixelfx://gallery/gallery/index.html"
      sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"
      allow="clipboard-write"
      style={{ display: 'block', width: '100%', height: '100%', border: 0 }}
    />
  )
}
