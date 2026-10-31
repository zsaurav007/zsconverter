declare module 'imagetracerjs' {
  interface TracePath { isholepath: boolean; segments: unknown[] }
  interface TraceData { width: number; height: number; layers: TracePath[][]; palette: { r: number; g: number; b: number; a: number }[] }
  type TraceOptions = Record<string, number | boolean | { r: number; g: number; b: number; a: number }[]>
  interface Tracer {
    colorquantization(image: { width: number; height: number; data: Uint8ClampedArray }, options: TraceOptions): { palette: { r: number; g: number; b: number; a: number }[] }
    imagedataToTracedata(image: { width: number; height: number; data: Uint8ClampedArray }, options: TraceOptions): TraceData
    getsvgstring(data: TraceData, options: TraceOptions): string
  }
  const tracer: Tracer
  export default tracer
}
