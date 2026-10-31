export interface PixelLayer { id: string; name: string; visible: boolean; canvas: HTMLCanvasElement }
export interface VectorLayer { id: string; name: string; visible: boolean; body: string; color: string }
export interface VectorArtwork { width: number; height: number; layers: VectorLayer[]; segments: number }
export const MAX_PIXELS = 12_000_000
export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  if (!Number.isFinite(width * height) || width < 1 || height < 1 || width * height > MAX_PIXELS || Math.max(width, height) > 16000) throw new Error('Image too large. Use an image up to 12 megapixels and 16,000 pixels per side.')
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  return canvas
}
export function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Your browser could not allocate an image canvas.')
  return ctx
}
export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try { return await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Cannot decode this image. Try a PNG, JPEG or WebP file.'))
    image.src = url
  }) } finally { URL.revokeObjectURL(url) }
}
export async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await loadImage(blob)
  const canvas = makeCanvas(img.naturalWidth, img.naturalHeight)
  context(canvas).drawImage(img, 0, 0)
  return canvas
}
export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image encoding failed.')), type, type === 'image/jpeg' ? 0.95 : undefined))
}
export function composite(layers: PixelLayer[], width: number, height: number, white = false): HTMLCanvasElement {
  const canvas = makeCanvas(width, height); const ctx = context(canvas)
  if (white) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height) }
  for (const layer of layers) if (layer.visible) ctx.drawImage(layer.canvas, 0, 0)
  return canvas
}
// Exclusive pixel ownership: a pixel belongs to exactly one layer, including its
// original alpha. Stacking all layers reproduces the source, with no duplicate subject.
// Hard selection boundaries are intentional; this is not soft hair matting or inpainting.
export function splitByMask(source: HTMLCanvasElement, mask: HTMLCanvasElement): { subject: HTMLCanvasElement; remainder: HTMLCanvasElement } {
  const { width, height } = source
  if (mask.width !== width || mask.height !== height) throw new Error('Selection mask size does not match the source.')
  const input = context(source).getImageData(0, 0, width, height)
  const maskData = context(mask).getImageData(0, 0, width, height).data
  const subject = makeCanvas(width, height), remainder = makeCanvas(width, height)
  const a = context(subject).createImageData(width, height), b = context(remainder).createImageData(width, height)
  let selected = 0, remaining = 0
  for (let i = 0; i < input.data.length; i += 4) {
    if (!input.data[i + 3]) continue
    const target = maskData[i + 3] >= 128 ? a.data : b.data
    target.set(input.data.subarray(i, i + 4), i)
    if (target === a.data) selected++; else remaining++
  }
  if (!selected || !remaining) throw new Error('The selection must separate visible pixels into two non-empty parts. Try manual selection.')
  context(subject).putImageData(a, 0, 0); context(remainder).putImageData(b, 0, 0)
  return { subject, remainder }
}
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
}
export function svgDocument(width: number, height: number, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}">${body}</svg>`
}
export function vectorSvg(art: VectorArtwork): string {
  return svgDocument(art.width, art.height, art.layers.filter(l => l.visible).map(l => `<g id="${escapeXml(l.id)}"><title>${escapeXml(l.name)}</title>${l.body}</g>`).join(''))
}
export function pixelBody(canvas: HTMLCanvasElement): string {
  return `<image x="0" y="0" width="${canvas.width}" height="${canvas.height}" xlink:href="${canvas.toDataURL('image/png')}"/>`
}
export function rasterSvg(layers: PixelLayer[], width: number, height: number): string {
  return svgDocument(width, height, layers.filter(l => l.visible).map(l => `<g id="${escapeXml(l.id)}"><title>${escapeXml(l.name)}</title>${pixelBody(l.canvas)}</g>`).join(''))
}
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove()
  // Allow slower browsers to consume the download before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// This script uses Illustrator itself to write a real native .ai file. It does
// not rename SVG/PDF data. Each source SVG is a full-artboard, single-layer file.
export function illustratorScript(layers: { name: string; file: string; visible: boolean }[]): string {
  const manifest = JSON.stringify(layers).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `#target illustrator
(function () {
  var entries = ${manifest};
  var root = new File($.fileName).parent;
  var result = null, source = null;
  try {
    for (var n = 0; n < entries.length; n++) {
      var input = new File(root.fsName + '/' + entries[n].file);
      if (!input.exists) throw new Error('Missing ' + entries[n].file + '. Extract the whole ZIP first.');
      source = app.open(input);
      var rect = source.artboards[0].artboardRect;
      var w = rect[2] - rect[0], h = rect[1] - rect[3];
      if (!result) {
        result = app.documents.add(DocumentColorSpace.RGB, w, h);
        result.artboards[0].artboardRect = [0, h, w, 0];
      } else {
        var destRect = result.artboards[0].artboardRect;
        if (Math.abs(w - destRect[2]) > 0.1 || Math.abs(h - destRect[1]) > 0.1)
          throw new Error('Layer artboard dimensions differ. Import stopped to avoid misalignment.');
      }
      var target = result.layers.add(); target.name = entries[n].name;
      var items = [];
      for (var i = 0; i < source.pageItems.length; i++) {
        var item = source.pageItems[i];
        if (item.parent.typename === 'Layer') items.push(item);
      }
      if (!items.length) throw new Error('No artwork was imported for ' + entries[n].name);
      for (var j = items.length - 1; j >= 0; j--) {
        var copy = items[j].duplicate(target, ElementPlacement.PLACEATBEGINNING);
        copy.translate(-rect[0], h - rect[1]);
      }
      target.visible = entries[n].visible;
      source.close(SaveOptions.DONOTSAVECHANGES); source = null;
    }
    for (var k = result.layers.length - 1; k >= 0; k--) {
      if (!result.layers[k].pageItems.length && !result.layers[k].layers.length) result.layers[k].remove();
    }
    var output = File.saveDialog('Save layered Illustrator artwork', '*.ai');
    if (output) {
      if (!/\\.ai$/i.test(output.name)) output = new File(output.fsName + '.ai');
      if (output.exists && !confirm('Replace ' + output.name + '?')) return;
      var options = new IllustratorSaveOptions(); options.pdfCompatible = true;
      result.saveAs(output, options);
      alert('Saved genuine Illustrator artwork with ' + entries.length + ' named layers.');
    }
  } catch (error) {
    if (source) { try { source.close(SaveOptions.DONOTSAVECHANGES); } catch (ignore) {} }
    alert('Import stopped: ' + error.message + '\\nAny partially imported document is left open for review.');
  }
})();`
}
export async function illustratorPackage(art: VectorArtwork | null, pixels: PixelLayer[], width: number, height: number): Promise<Blob> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  const layers = art ? art.layers.map(l => ({ ...l, body: l.body })) : pixels.map(l => ({ ...l, body: pixelBody(l.canvas) }))
  const manifest = layers.map((l, i) => ({ name: l.name, visible: l.visible, file: `layers/layer-${String(i + 1).padStart(3, '0')}.svg` }))
  layers.forEach((l, i) => zip.file(manifest[i].file, svgDocument(width, height, l.body)))
  zip.file('artwork.svg', art ? vectorSvg(art) : rasterSvg(pixels, width, height))
  zip.file('Create Illustrator Layers.jsx', illustratorScript(manifest))
  zip.file('README.txt', `Extract ALL files first. In Adobe Illustrator choose File > Scripts > Other Script, select Create Illustrator Layers.jsx, then choose the .ai save location. Illustrator must be installed. The website never asks for your Adobe credentials.\n\n${art ? 'Vector mode: colours are separate editable path layers, not original semantic objects. Text is traced outlines, not editable type. Tracing approximates colours and edges.' : 'Photo mode: layers are embedded raster images. Selected pixels have been removed from the remainder. Empty areas behind removed subjects are transparent, not reconstructed.'}\n\nartwork.svg is a browser-compatible preview of visible layers. The script imports all layers and restores their visibility. Layer files share an artboard so their positions match. Check the result in your Illustrator version.\n`)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
