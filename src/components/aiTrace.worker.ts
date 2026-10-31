/// <reference path="./imagetracerjs.d.ts" />
import ImageTracer from 'imagetracerjs'

// The CPU-heavy tracer runs off the UI thread. No network or document upload.
self.onmessage = (event: MessageEvent<{ width: number; height: number; buffer: ArrayBuffer; colors: number; detail: number }>) => {
  try {
    const { width, height, buffer, colors, detail } = event.data
    if (width * height > 2_000_000 || colors < 2 || colors > 32) throw new Error('Trace limit exceeded. Choose a smaller trace size or fewer colours.')
    const options = {
      numberofcolors: colors, colorsampling: 2, colorquantcycles: 3,
      mincolorratio: 0, layering: 0, ltres: detail, qtres: detail,
      pathomit: 0, rightangleenhance: true, blurradius: 0,
      strokewidth: 0, scale: 1, roundcoords: 3, viewbox: true,
      desc: false, linefilter: false,
    }
    const rgba = new Uint8ClampedArray(buffer)
    let hasTransparent = false, firstVisible = -1
    for (let i = 0; i < rgba.length; i += 4) {
      if (!rgba[i + 3]) hasTransparent = true
      else if (firstVisible < 0) firstVisible = i
    }
    if (firstVisible < 0) throw new Error('This image is completely transparent.')
    // Reserve a genuine transparent palette entry. Unmodified ImageTracer's
    // grid sampling can miss small transparent holes and turn them into colours.
    let data
    if (hasTransparent) {
      const sample = rgba.slice()
      for (let i = 0; i < sample.length; i += 4) if (!sample[i + 3]) sample.set(rgba.subarray(firstVisible, firstVisible + 4), i)
      const palette = ImageTracer.colorquantization({ width, height, data: sample }, { ...options, numberofcolors: colors - 1 }).palette
      palette.push({ r: 0, g: 0, b: 0, a: 0 })
      data = ImageTracer.imagedataToTracedata({ width, height, data: rgba }, { ...options, pal: palette, colorquantcycles: 1 })
    } else {
      data = ImageTracer.imagedataToTracedata({ width, height, data: rgba }, options)
    }
    let segments = 0
    const layers = data.layers.flatMap((paths, index) => {
      const color = data.palette[index]
      if (color.a === 0 || !paths.some(p => !p.isholepath)) return []
      segments += paths.reduce((sum, p) => sum + p.segments.length, 0)
      if (segments > 200_000) throw new Error('This image creates too many vector points. Reduce colours or trace size, or use photo layers.')
      const svg = ImageTracer.getsvgstring({ ...data, layers: [paths], palette: [color] }, options)
      const body = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'))
      const hex = '#' + [color.r, color.g, color.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
      return [{ id: `colour-${index}`, name: `Colour ${hex}`, body, color: hex, visible: true }]
    })
    if (!layers.length) throw new Error('No visible shapes found in this image.')
    self.postMessage({ ok: true, width, height, layers, segments })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Tracing failed.' })
  }
}
