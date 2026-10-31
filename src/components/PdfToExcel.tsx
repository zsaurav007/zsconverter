'use client'

/* SINGLE-FILE, BROWSER-ONLY EDITION
 * Install: npm install pdfjs-dist@5.4.624 exceljs@4.4.0 docx@9.15.0 tesseract.js@6.0.1
 * Vercel: use Node.js >=22.13 (or 24) for the PDF.js package.
 * No Python backend, API route, or OCR API key.
 * Reuses @/components/CustomDropdown (the searchable version).
 * Editable layout uses docx/shapes, available in docx 9.8.1.
 * Tesseract 6 is intentional: v7 relaxed-SIMD crashed with full float models.
 * Verified: Next.js 16.3.8 build, mixed Bangla/English OCR fixture, DOCX XML.
 * The OCR fixture missed punctuation; user-document accuracy is unverified.
 * Real-browser OCR accuracy and final Word pagination were not validated.
 * PDF.js worker and OCR assets are downloaded from their package CDNs.
 * Documents and OCR images are processed locally, not uploaded by this component.
 * Local OCR targets printed text; reliable arbitrary handwriting is not supported.
 * Word appearance mode preserves visible pages as images, NOT editable text.
 */
import { useEffect, useRef, useState } from 'react'
import CustomDropdown from '@/components/CustomDropdown'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Worker } from 'tesseract.js'
import type { ISectionOptions } from 'docx'

type Format = 'excel' | 'word-visual' | 'word-editable'
type PageMode = 'all' | 'custom' | 'except'
type Piece = { text: string; x: number; y: number; width: number; height: number; font?: string; bold?: boolean; italic?: boolean; top?: number; line?: string; paragraph?: string; confidence?: number; color?: string; background?: string }
type Row = { y: number; height: number; cells: Piece[] }
type Candidate = { rows: Row[]; cuts: number[] }

function selectedPages(mode: PageMode, range: string, total: number): number[] {
  if (mode === 'all') return Array.from({ length: total }, (_, i) => i + 1)
  if (!range.trim()) throw new Error('Enter a page range such as 1-3, 5.')
  const chosen = new Set<number>()
  for (const part of range.split(',')) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) throw new Error('Invalid page range. Use whole numbers and ascending ranges.')
    const first = Number(match[1]), last = Number(match[2] || match[1])
    if (first < 1 || last < first || last > total) throw new Error(`Page numbers must be within 1–${total}.`)
    for (let p = first; p <= last; p++) chosen.add(p)
  }
  const pages = Array.from({ length: total }, (_, i) => i + 1).filter(p => mode === 'custom' ? chosen.has(p) : !chosen.has(p))
  if (!pages.length) throw new Error('No pages selected.')
  return pages
}
function median(numbers: number[]): number {
  const sorted = [...numbers].sort((a,b) => a-b), n = sorted.length
  return n ? n % 2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2 : 10
}
function rowsFromPieces(pieces: Piece[]): Row[] {
  const rows: Row[] = []
  for (const item of [...pieces].sort((a,b) => a.y-b.y || a.x-b.x)) {
    const row = rows[rows.length-1]
    // Compare against a fixed baseline: no accumulated Y drift.
    if (row && Math.abs(row.y-item.y) <= Math.max(2, Math.min(row.height,item.height)*0.35)) row.cells.push(item)
    else rows.push({ y:item.y, height:item.height, cells:[item] })
  }
  for (const row of rows) {
    const merged: Piece[] = []
    const gap = Math.max(12, median(row.cells.map(c => c.width / Math.max(1,c.text.length))) * 3)
    for (const item of row.cells.sort((a,b) => a.x-b.x)) {
      const previous = merged[merged.length-1]
      if (previous && item.x-(previous.x+previous.width) <= gap) {
        const distance = item.x-(previous.x+previous.width)
        const separator = distance > Math.min(previous.height,item.height)*0.12 && !/\s$/.test(previous.text) && !/^\s/.test(item.text) ? ' ' : ''
        previous.text += separator+item.text
        previous.width = Math.max(previous.width,item.x+item.width-previous.x)
      } else merged.push({...item})
    }
    row.cells = merged
  }
  return rows
}
function inferTables(rows: Row[]): Candidate[] {
  // Conservative candidates: >=3 consecutive multi-cell rows with shared gutters.
  // Full page text and previews remain available even if no table is recognized.
  const result: Candidate[] = []
  let group: Row[] = [], gaps: [number,number][] = []
  const flush = () => { if (group.length >= 3) result.push({rows:group,cuts:gaps.map(([a,b])=>(a+b)/2)}); group=[];gaps=[] }
  for (const row of rows) {
    if (row.cells.length < 2 || row.cells.length > 40) { flush(); continue }
    const candidate: [number,number][] = row.cells.slice(0,-1).map((c,i) => [c.x+c.width,row.cells[i+1].x])
    const shared = candidate.map(([a,b],i) => [Math.max(a,gaps[i]?.[0]??a),Math.min(b,gaps[i]?.[1]??b)] as [number,number])
    const last=group[group.length-1]
    if (last && (row.cells.length!==last.cells.length || row.y-last.y>Math.max(36,row.height*3) || shared.some(([a,b])=>b-a<5))) flush()
    gaps=group.length ? shared : candidate
    group.push(row)
  }
  flush()
  return result
}
function safeText(text: string): string { return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'') }
function waitFor<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'))}
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);reject(new Error('An operation timed out. Try fewer pages or a clearer scan.'))},300000)
    signal.addEventListener('abort',abort,{once:true})
    task.then(value=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve(value)},error=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(error)})
    if(signal.aborted)abort()
  })
}
const yieldUI = () => new Promise<void>(resolve => setTimeout(resolve,0))

// Sample text colour against the surrounding paper/panel. This is an estimate,
// especially on photographs, gradients, outlined lettering and overlapping art.
function sampleColours(ctx: CanvasRenderingContext2D, piece: Piece, sx: number, sy: number) {
  const x=Math.max(0,Math.floor(piece.x*sx)), y=Math.max(0,Math.floor((piece.top??piece.y-piece.height)*sy))
  const w=Math.max(1,Math.min(ctx.canvas.width-x,Math.ceil(piece.width*sx)))
  const h=Math.max(1,Math.min(ctx.canvas.height-y,Math.ceil(piece.height*sy)))
  if(x>=ctx.canvas.width||y>=ctx.canvas.height)return {color:'000000',background:'FFFFFF'}
  const pad=3,left=Math.max(0,x-pad),top=Math.max(0,y-pad)
  const right=Math.min(ctx.canvas.width,x+w+pad),bottom=Math.min(ctx.canvas.height,y+h+pad)
  const pixels=ctx.getImageData(left,top,right-left,bottom-top)
  const counts=new Map<string,{n:number;r:number;g:number;b:number}>()
  const key=(r:number,g:number,b:number)=>`${r>>4},${g>>4},${b>>4}`
  const add=(r:number,g:number,b:number)=>{const k=key(r,g,b),v=counts.get(k)??{n:0,r:0,g:0,b:0};v.n++;v.r+=r;v.g+=g;v.b+=b;counts.set(k,v)}
  for(let j=0;j<pixels.height;j++)for(let i=0;i<pixels.width;i++){
    if(i+left>=x&&i+left<x+w&&j+top>=y&&j+top<y+h)continue
    const o=(j*pixels.width+i)*4;add(pixels.data[o],pixels.data[o+1],pixels.data[o+2])
  }
  const popular=()=>[...counts.values()].sort((a,b)=>b.n-a.n)[0]
  const bg=popular()??{n:1,r:255,g:255,b:255}, rgb=[bg.r/bg.n,bg.g/bg.n,bg.b/bg.n]
  counts.clear()
  for(let j=y-top;j<y-top+h;j++)for(let i=x-left;i<x-left+w;i++){
    const o=(j*pixels.width+i)*4,r=pixels.data[o],g=pixels.data[o+1],b=pixels.data[o+2]
    if(Math.hypot(r-rgb[0],g-rgb[1],b-rgb[2])>65)add(r,g,b)
  }
  const fg=popular(),hex=(v:number[])=>v.map(n=>Math.round(n).toString(16).padStart(2,'0')).join('').toUpperCase()
  return {color:fg?hex([fg.r/fg.n,fg.g/fg.n,fg.b/fg.n]):'000000',background:hex(rgb)}
}
type TextLine = { pieces: Piece[]; x: number; top: number; right: number; bottom: number; height: number; paragraph?: string }
type TextParagraph = { lines: TextLine[]; x: number; top: number; right: number; bottom: number }
function textLine(pieces: Piece[]): TextLine {
  const ordered=[...pieces].sort((a,b)=>a.x-b.x)
  return {pieces:ordered,x:Math.min(...pieces.map(p=>p.x)),top:Math.min(...pieces.map(p=>p.top??p.y-p.height)),right:Math.max(...pieces.map(p=>p.x+p.width)),bottom:Math.max(...pieces.map(p=>(p.top??p.y-p.height)+p.height)),height:median(pieces.map(p=>p.height)),paragraph:ordered[0]?.paragraph}
}
function layoutLines(pieces: Piece[]): TextLine[] {
  const explicit=new Map<string,Piece[]>(),native:Piece[][]=[]
  for(const p of pieces.filter(p=>p.text.trim())){
    if(p.line){const line=explicit.get(p.line)??[];line.push(p);explicit.set(p.line,line)}
    else {
      // PDF text items are runs, not necessarily complete lines. Reassemble only
      // nearby runs with a shared baseline; large gutters remain separate.
      native.push([p])
    }
  }
  const rows:Piece[][]=[]
  for(const [p] of native.sort((a,b)=>a[0].y-b[0].y||a[0].x-b[0].x)){
    const row=rows.find(r=>Math.abs(r[0].y-p.y)<=Math.max(2,Math.min(r[0].height,p.height)*.3))
    if(row)row.push(p);else rows.push([p])
  }
  const lines=[...explicit.values()].map(textLine)
  for(const row of rows){
    let group:Piece[]=[]
    for(const p of row.sort((a,b)=>a.x-b.x)){
      const previous=group[group.length-1]
      if(previous&&p.x-(previous.x+previous.width)>Math.max(10,Math.min(p.height,previous.height)*1.8)){lines.push(textLine(group));group=[]}
      group.push(p)
    }
    if(group.length)lines.push(textLine(group))
  }
  return lines.sort((a,b)=>a.top-b.top||a.x-b.x)
}
function layoutParagraphs(pieces: Piece[]): TextParagraph[] {
  const paragraphs:TextParagraph[]=[]
  const isList=(line:TextLine)=>bulletPattern.test(line.pieces.map(p=>p.text).join(' '))
  const bold=(line:TextLine)=>line.pieces.filter(p=>p.bold).reduce((n,p)=>n+p.width,0)>line.pieces.reduce((n,p)=>n+p.width,0)*.6
  for(const line of layoutLines(pieces)){
    let target:TextParagraph|undefined,best=Infinity
    for(const paragraph of paragraphs){
      const last=paragraph.lines[paragraph.lines.length-1],h=Math.max(1,median([last.height,line.height]))
      const step=line.top-last.top
      if(step<h*.45||step>h*2.2)continue
      // Honour OCR paragraph identities. Distinct OCR paragraphs are not joined.
      if((line.paragraph||last.paragraph)&&line.paragraph!==last.paragraph)continue
      const sameOCR=!!line.paragraph&&line.paragraph===last.paragraph
      const leftDifference=Math.abs(line.x-paragraph.x)
      if(leftDifference>h*(sameOCR?3:1.5)||Math.min(line.right,paragraph.right)-Math.max(line.x,paragraph.x)<=0)continue
      if(Math.max(line.height,last.height)/Math.max(1,Math.min(line.height,last.height))>1.4)continue
      if(isList(line)||bold(line)!==bold(last))continue
      if(!sameOCR&&paragraph.lines.length>1&&(last.right-last.x)<(paragraph.right-paragraph.x)*.7)continue
      const score=step+leftDifference
      if(score<best){best=score;target=paragraph}
    }
    if(target){target.lines.push(line);target.x=Math.min(target.x,line.x);target.top=Math.min(target.top,line.top);target.right=Math.max(target.right,line.right);target.bottom=Math.max(target.bottom,line.bottom)}
    else paragraphs.push({lines:[line],x:line.x,top:line.top,right:line.right,bottom:line.bottom})
  }
  return paragraphs.sort((a,b)=>a.top-b.top||a.x-b.x)
}
function paragraphPieces(paragraph:TextParagraph): Piece[] {
  // No hard line breaks: Word wraps the single paragraph inside its source box.
  // Keep styles/confidence per run. Never guess spelling or remove hyphens.
  const result:Piece[]=[]
  for(const line of paragraph.lines){
    for(let i=0;i<line.pieces.length;i++){
      const p=line.pieces[i],previous=line.pieces[i-1]
      const space=result.length>0&&(i===0||!!p.line||!!previous&&p.x-previous.x-previous.width>Math.min(p.height,previous.height)*.12||/\s$/.test(previous?.text??'')||/^\s/.test(p.text))
      const text=p.text.replace(/\s+/g,' ').trim()
      if(text)result.push({...p,text:(space?' ':'')+text})
    }
  }
  return result
}

type TextSection = { paragraphs:TextParagraph[]; list:boolean; x:number; top:number; right:number; bottom:number }
const bulletPattern=/^\s*(?:[•●▪◦‣◆■□✓✔–—]|[-*]\s|[0-9০-৯]+[.)।]\s)/u
function textSections(pieces:Piece[]):TextSection[] {
  const sections:TextSection[]=[]
  for(const paragraph of layoutParagraphs(pieces)){
    const text=paragraphPieces(paragraph).map(p=>p.text).join('')
    const bullet=bulletPattern.test(text),h=median(paragraph.lines.map(l=>l.height))
    let target:TextSection|undefined,best=Infinity
    for(const section of sections){
      if(!section.list)continue
      const gap=paragraph.top-section.bottom
      const sameColumn=Math.abs(paragraph.x-section.x)<=h*3&&Math.min(paragraph.right,section.right)>Math.max(paragraph.x,section.x)
      const previous=section.paragraphs[section.paragraphs.length-1]
      const compatible=Math.max(h,previous.lines[0].height)/Math.max(1,Math.min(h,previous.lines[0].height))<1.4
      const continuation=!bullet&&paragraph.x>section.x+h*.35&&paragraph.x<section.x+h*3&&!paragraph.lines[0].pieces.every(p=>p.bold)
      if(sameColumn&&compatible&&gap>=-1&&gap<=h*(bullet?1.8:1.1)&&(bullet||continuation)&&gap<best){target=section;best=gap}
    }
    if(target){
      if(bullet)target.paragraphs.push(paragraph)
      else {
        const item=target.paragraphs[target.paragraphs.length-1]
        item.lines.push(...paragraph.lines);item.right=Math.max(item.right,paragraph.right);item.bottom=Math.max(item.bottom,paragraph.bottom)
      }
      target.x=Math.min(target.x,paragraph.x);target.top=Math.min(target.top,paragraph.top);target.right=Math.max(target.right,paragraph.right);target.bottom=Math.max(target.bottom,paragraph.bottom)
    }else sections.push({paragraphs:[paragraph],list:bullet,x:paragraph.x,top:paragraph.top,right:paragraph.right,bottom:paragraph.bottom})
  }
  return sections.sort((a,b)=>a.top-b.top||a.x-b.x)
}
function sectionBoxes(sections:TextSection[],pageWidth:number,pageHeight:number){
  return sections.map(section=>{
    const x=Math.max(0,section.x),y=Math.max(0,section.top)
    // No extra width: added padding used to intrude into nearby columns.
    const width=Math.max(1,Math.min(pageWidth,section.right)-x)
    const next=sections.filter(s=>s!==section&&s.top>=section.bottom-.5&&Math.min(s.right,x+width)>Math.max(s.x,x)).reduce((n,s)=>Math.min(n,s.top-1),pageHeight)
    const height=Math.max(1,Math.min(pageHeight,next,section.bottom+2)-y)
    return {section,x,y,width,height}
  })
}
function boxesOverlap(boxes:ReturnType<typeof sectionBoxes>):boolean {
  return boxes.some((a,i)=>boxes.slice(i+1).some(b=>Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.5&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.5))
}
function pieceFont(p:Piece):string {
  return /[\u0980-\u09ff]/.test(p.text)?'Nirmala UI':/serif/i.test(p.font??'')&&!/sans/i.test(p.font??'')?'Times New Roman':'Arial'
}
function paragraphFontSize(paragraph:TextParagraph,ocr:boolean):number {
  // One base size per paragraph: punctuation/small glyph boxes must not alter leading.
  return Math.max(4,Math.min(100,median(paragraph.lines.map(line=>line.height))*(ocr?.9:1)))
}
function estimatedHeight(section:TextSection,width:number,ctx:CanvasRenderingContext2D,ocr:boolean):number {
  let height=0
  for(const paragraph of section.paragraphs){
    const size=paragraphFontSize(paragraph,ocr),available=Math.max(1,width-(section.list?size:0))
    let used=0,lines=1
    for(const p of paragraphPieces(paragraph)){
      ctx.font=`${p.italic?'italic ':''}${p.bold?'bold ':''}${size}px "${pieceFont(p)}"`
      for(const token of p.text.match(/\s+|\S+/g)??[]){
        const measured=ctx.measureText(token).width
        if(used&&used+measured>available){lines++;used=0}
        if(measured>available){lines+=Math.max(0,Math.ceil(measured/available)-1);used=measured%available}else used+=measured
      }
    }
    height+=lines*size*1.25+size*.2
  }
  return height
}

type OCRWord={text:string;confidence:number;x:number;y:number;width:number;height:number;line:string;paragraph?:string}
function ocrWords(data:import('tesseract.js').Page):OCRWord[]{
  const words:OCRWord[]=[]
  let paragraph=0,line=0
  for(const block of data.blocks??[])for(const par of block.paragraphs){
    const pid=String(paragraph++)
    for(const row of par.lines){const lid=String(line++);for(const word of row.words){
      const b=word.bbox
      if(word.text.trim()&&b.x1>b.x0&&b.y1>b.y0)words.push({text:word.text,confidence:word.confidence,x:b.x0,y:b.y0,width:b.x1-b.x0,height:b.y1-b.y0,line:lid,paragraph:pid})
    }}
  }
  // Some outputs contain TSV word geometry without the nested blocks tree.
  if(!words.length&&data.tsv){
    for(const row of data.tsv.split(/\r?\n/).slice(1)){
      const c=row.split('\t');if(c.length<12||c[0]!=='5')continue
      const [x,y,width,height,confidence]=c.slice(6,11).map(Number),text=c.slice(11).join('\t').trim()
      if(text&&[x,y,width,height,confidence].every(Number.isFinite)&&width>0&&height>0)words.push({text,confidence,x,y,width,height,line:c.slice(1,5).join('-'),paragraph:c.slice(1,4).join('-')})
    }
  }
  return words
}
function ocrQuality(words:OCRWord[]):number {
  // Compare recognition evidence, not just average confidence (which favours
  // a single easy word). This heuristic is not a correctness guarantee.
  return words.reduce((n,w)=>n+Math.min(30,(w.text.match(/[\p{L}\p{N}]/gu)??[]).length)*Math.pow(Math.max(0,w.confidence)/100,2),0)
}
function weakOCR(words:OCRWord[]):boolean {
  return words.length<10||words.reduce((n,w)=>n+w.confidence,0)/Math.max(1,words.length)<78||words.filter(w=>w.confidence<70).length/Math.max(1,words.length)>.35
}
function contrastCopy(source:HTMLCanvasElement):HTMLCanvasElement{
  const result=document.createElement('canvas');result.width=source.width;result.height=source.height
  const ctx=result.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas unavailable.')
  ctx.drawImage(source,0,0)
  const image=ctx.getImageData(0,0,result.width,result.height),hist=new Uint32Array(256)
  for(let i=0;i<image.data.length;i+=4)hist[Math.round(.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2])]++
  const count=result.width*result.height
  let sum=0,lo=0,hi=255
  for(let i=0;i<256;i++){sum+=hist[i];if(sum>=count*.01){lo=i;break}}
  sum=0;for(let i=255;i>=0;i--){sum+=hist[i];if(sum>=count*.01){hi=i;break}}
  // Preserve antialiasing. Hard thresholding can destroy Bangla vowel marks.
  for(let i=0;i<image.data.length;i+=4){const grey=.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2],value=hi-lo>20?Math.max(0,Math.min(255,(grey-lo)*255/(hi-lo))):grey;image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255}
  ctx.putImageData(image,0,0);return result
}

const CSS = `
.pse,.pse *{box-sizing:border-box}.pse{max-width:820px;margin:auto;padding:28px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;color:#253447;font:14px/1.6 Arial,sans-serif;color-scheme:light}.pse h2{font-size:22px;letter-spacing:-.4px;margin:0;font-weight:700}.pse p{margin:6px 0}.pse .muted,.pse .hint{color:#728094}.pse .hint{font-size:12px;margin-top:12px}.pse label{display:block;font-size:12px;font-weight:600}.pse .drop{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:126px;margin:22px 0;background:#fafbfd;border:1px dashed #cbd5e1;border-radius:10px;text-align:center;padding:20px;overflow-wrap:anywhere;cursor:pointer}.pse .drop strong{font-size:15px}.pse .drop span{font-size:12px;font-weight:400}.pse .drop input[type=file]{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;margin:0}.pse .drop:focus-within{outline:2px solid #66869e;outline-offset:3px}.pse .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pse .dropdown{position:relative;min-width:0}.pse .dropdown>label{margin-bottom:6px}.pse .dropdown:focus-within{z-index:101}.pse input:not([type=checkbox]):not([type=file]){width:100%;display:block;background:#fff;color:#253447;border:1px solid #cbd5e1;border-radius:8px;padding:11px;margin-top:6px;font:14px Arial,sans-serif}.pse input[type=checkbox]{margin:0 8px 0 0;accent-color:#456f90}.pse small{display:block;font-size:12px;color:#728094;font-weight:400}.pse fieldset{border:0;margin:0;padding:0;min-width:0}.pse .actions{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 10px}.pse .actions button,.pse .download{padding:11px 20px;border-radius:8px;border:1px solid #d5dfe7;color:#395b75;background:#fff;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}.pse .actions .primary{background:#456f90;color:#fff;border-color:#456f90}.pse button:disabled{opacity:.5;cursor:not-allowed}.pse .notice{padding:12px;border-radius:8px;margin-top:12px}.pse .error{background:#fff2ee;color:#a03825}.pse details{margin-top:18px}.pse .advanced{border-top:1px solid #edf0f4;border-bottom:1px solid #edf0f4;padding:12px 0}.pse summary{font-size:12px;font-weight:600;cursor:pointer;color:#52657b}.pse details[open]>summary{margin-bottom:16px}.pse .checks{display:grid;gap:12px;margin-top:18px}.pse .review{font-size:12px}.pse .review li{margin-bottom:10px}.pse progress{width:100%;height:5px;accent-color:#456f90}.pse footer{font-size:11px;color:#8793a3;margin-top:18px}.pse :focus-visible{outline:2px solid #8ab7d5;outline-offset:2px}@media(max-width:640px){.pse{padding:18px}.pse .grid{grid-template-columns:1fr}}
`

export default function PdfToExcel() {
  const [file,setFile]=useState<File|null>(null)
  const [format,setFormat]=useState<Format>('excel')
  const [pageMode,setPageMode]=useState<PageMode>('all'),[range,setRange]=useState(''),[password,setPassword]=useState('')
  const [ocr,setOcr]=useState<'off'|'auto'|'always'>('auto'),[language,setLanguage]=useState('ben+eng')
  const [dpi,setDpi]=useState('300'),[columns,setColumns]=useState('auto')
  const [wordLayout,setWordLayout]=useState<'source'|'flow'>('source')
  const [graphics,setGraphics]=useState(true),[markUncertain,setMarkUncertain]=useState(true)
  const [previews,setPreviews]=useState(true),[tables,setTables]=useState(true)
  const [top,setTop]=useState(0),[bottom,setBottom]=useState(0)
  const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[notes,setNotes]=useState<string[]>([])
  const [result,setResult]=useState<{url:string;name:string}|null>(null)
  const abortController=useRef<AbortController|null>(null)
  const mounted=useRef(true), cancelled=useRef(false), lock=useRef(false), objectURL=useRef('')
  const loading=useRef<PDFDocumentLoadingTask|null>(null),rendering=useRef<RenderTask|null>(null),worker=useRef<Worker|null>(null)
  useEffect(()=>{
    mounted.current=true
    return()=>{mounted.current=false;cancelled.current=true;abortController.current?.abort();rendering.current?.cancel();void loading.current?.destroy();void worker.current?.terminate();if(objectURL.current)URL.revokeObjectURL(objectURL.current)}
  },[])
  const reset=()=>{if(objectURL.current)URL.revokeObjectURL(objectURL.current);objectURL.current='';setResult(null);setError('');setNotes([]);setStatus('')}
  const choose=(next?:File)=>{
    if(lock.current||!next)return
    reset();setFile(null)
    if(!/\.pdf$/i.test(next.name)){setError('Choose a PDF file.');return}
    setFile(next);setPassword('');setPageMode('all');setRange('')
  }
  const stop=()=>{cancelled.current=true;abortController.current?.abort();setStatus('Stopping…');rendering.current?.cancel();void loading.current?.destroy();void worker.current?.terminate()}
  const convert=async()=>{
    if(!file||lock.current)return
    reset();lock.current=true;cancelled.current=false;setBusy(true)
    const operation=new AbortController();abortController.current=operation
    const wait=<T,>(task:Promise<T>)=>waitFor(task,operation.signal)
    let pdf:PDFDocumentProxy|null=null
    const canvases:HTMLCanvasElement[]=[]
    const check=()=>{if(cancelled.current||!mounted.current)throw new Error('Cancelled')}
    const report:string[]=[]
    const update=(text:string)=>{if(mounted.current&&!cancelled.current)setStatus(text)}
    try {
      if(!Number.isFinite(top)||!Number.isFinite(bottom)||top<0||bottom<0||top>40||bottom>40)throw new Error('Top and bottom exclusions must each be between 0 and 40%.')
      update('Loading PDF tools…')
      const pdfjs=await wait(import('pdfjs-dist'))
      check()
      const assets=`https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/`
      pdfjs.GlobalWorkerOptions.workerSrc=assets+'build/pdf.worker.min.mjs'
      const sourceBytes=await wait(file.arrayBuffer());check()
      loading.current=pdfjs.getDocument({data:new Uint8Array(sourceBytes),password,cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/'})
      pdf=await wait(loading.current.promise)
      check()
      const pages=selectedPages(pageMode,range,pdf.numPages)
      const excelModule=format==='excel' ? await wait(import('exceljs')) : null
      const excel=excelModule ? (excelModule.default ?? excelModule) : null
      const word=format!=='excel' ? await wait(import('docx')) : null
      const shapes=format==='word-editable'?await wait(import('docx/shapes')):null
      const workbook=excel?new excel.Workbook():null
      const summary=workbook?.addWorksheet('Read me')
      summary?.addRow(['Source page','Detected tables','Notes'])
      if(summary){summary.columns=[{width:16},{width:20},{width:100}];summary.getRow(1).font={bold:true};summary.getColumn(3).alignment={wrapText:true};summary.views=[{state:'frozen',ySplit:1}]}
      const sections:ISectionOptions[]=[]
      for(let index=0;index<pages.length;index++) {
        check();const number=pages[index]
        update(`Reading page ${number} (${index+1}/${pages.length})…`);await yieldUI()
        const page=await wait(pdf.getPage(number)), viewport=page.getViewport({scale:1})
        const content=format==='word-visual'?null:await wait(page.getTextContent())
        let pieces:Piece[]=[]
        let rotated=false
        for(const item of content?.items??[]){
          if(!('str' in item)||!item.str.trim())continue
          const transform=pdfjs.Util.transform(viewport.transform,item.transform)
          if(Math.abs(transform[1])>0.1 || Math.abs(transform[2])>0.1)rotated=true
          const style=content?.styles[item.fontName]
          pieces.push({text:item.str,x:transform[4],y:transform[5],width:Math.abs(item.width),height:Math.max(1,Math.hypot(transform[2],transform[3])),top:transform[5]-Math.hypot(transform[2],transform[3])*(style?.ascent??0.85),font:style?.fontFamily,bold:/bold/i.test(item.fontName+' '+style?.fontFamily),italic:/italic|oblique/i.test(item.fontName+' '+style?.fontFamily)})
        }
        const pageNotes:string[]=[]
        if(rotated)pageNotes.push('Rotated text: table and editable reading order may be inaccurate; compare the preview.')
        const nativeText=pieces.map(p=>p.text).join(' ')
        const useOCR=format!=='word-visual'&&(ocr==='always'||(ocr==='auto'&&(nativeText.trim().length<25||nativeText.includes('\ufffd'))))
        let canvas:HTMLCanvasElement|null=null
        const getCanvas=async()=>{
          if(canvas)return canvas
          const scale=Math.min(useOCR?Number(dpi)/72:2,(useOCR?6000:3200)/Math.max(viewport.width,viewport.height),Math.sqrt((useOCR?20e6:8e6)/(viewport.width*viewport.height)))
          const renderViewport=page.getViewport({scale})
          canvas=document.createElement('canvas');canvases.push(canvas)
          canvas.width=Math.ceil(renderViewport.width);canvas.height=Math.ceil(renderViewport.height)
          const context=canvas.getContext('2d');if(!context)throw new Error('Canvas rendering is unavailable.')
          rendering.current=page.render({canvas,canvasContext:context,viewport:renderViewport})
          await wait(rendering.current.promise);rendering.current=null;check();return canvas
        }
        let ocrUnpositioned=false
        if(useOCR){
          update(`Recognizing printed text on page ${number}…`)
          const t=await wait(import('tesseract.js'))
          if(!worker.current){
            update('Loading high-accuracy language models (first use can take a few minutes)…')
            worker.current=await wait(t.createWorker(language,t.OEM.LSTM_ONLY,{
              langPath:'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_best@4.1.0',
              gzip:false,cachePath:'pdf-office-tessdata-best-v2',
              logger:m=>{if(m.status==='recognizing text')update(`Page ${number}: OCR ${Math.round(m.progress*100)}%`)}
            },'dotproduct generic').then(created=>{if(operation.signal.aborted){void created.terminate();throw new Error('Cancelled')}return created}))
          }
          const image=await getCanvas()
          const effectiveDpi=Math.round(image.width/viewport.width*72)
          await wait(worker.current!.setParameters({tessedit_pageseg_mode:columns==='single'?t.PSM.SINGLE_BLOCK:t.PSM.AUTO,user_defined_dpi:String(effectiveDpi),preserve_interword_spaces:'1'}))
          check();const nativePieces=pieces;pieces=[]
          const scaleX=viewport.width/image.width,scaleY=viewport.height/image.height
          const regions=columns==='two'?2:columns==='three'?3:1
          let score=0,wordCount=0
          for(let region=0;region<regions;region++){
            check()
            // Real column crops avoid cross-column reading order; no overlap or duplicate words.
            const left=Math.floor(image.width*region/regions),right=Math.floor(image.width*(region+1)/regions)
            const crop=document.createElement('canvas');crop.width=right-left;crop.height=image.height
            const context=crop.getContext('2d');if(!context)throw new Error('Canvas unavailable.')
            context.drawImage(image,left,0,crop.width,crop.height,0,0,crop.width,crop.height)
            let bestWords:OCRWord[]=[],plainText='',passName='original'
            try{
              const recognize=async(input:HTMLCanvasElement,psm:import('tesseract.js').PSM)=>{
                await wait(worker.current!.setParameters({tessedit_pageseg_mode:psm}))
                const {data}=await wait(worker.current!.recognize(input,{}, {text:true,blocks:true,tsv:true}))
                check();if(data.text.length>plainText.length)plainText=data.text
                return ocrWords(data)
              }
              const retry=async(input:HTMLCanvasElement)=>{
                try{return await recognize(input,t.PSM.SPARSE_TEXT)}catch{check();pageNotes.push(`Region ${region+1}: an OCR recovery pass failed; the earlier result was retained.`);return [] as OCRWord[]}
              }
              const initial=columns==='single'?t.PSM.SINGLE_BLOCK:t.PSM.AUTO
              bestWords=await recognize(crop,initial)
              if(weakOCR(bestWords)){
                update(`Page ${number}: retrying difficult text…`)
                const sparse=await retry(crop)
                if(ocrQuality(sparse)>ocrQuality(bestWords)){bestWords=sparse;passName='sparse text'}
                if(weakOCR(bestWords)){
                  const enhanced=contrastCopy(crop)
                  try{const recovered=await retry(enhanced);if(ocrQuality(recovered)>ocrQuality(bestWords)){bestWords=recovered;passName='contrast + sparse text'}}finally{enhanced.width=1;enhanced.height=1}
                }
              }
              if(passName!=='original')pageNotes.push(`Region ${region+1}: selected ${passName} recovery. Compare the recovered text with the source.`)
              for(const item of bestWords){
                pieces.push({text:item.text,x:(item.x+left)*scaleX,y:(item.y+item.height)*scaleY,top:item.y*scaleY,width:item.width*scaleX,height:item.height*scaleY,line:`${region}-${item.line}`,paragraph:passName==='original'?`${region}-${item.paragraph}`:undefined,confidence:item.confidence})
                score+=item.confidence;wordCount++
              }
              if(!bestWords.length&&plainText.trim()){
                // Retain text even when geometry is missing, but do not claim
                // invented coordinates preserve the design. Force flowing Word.
                ocrUnpositioned=true
                plainText.split(/\r?\n/).filter(text=>text.trim()).forEach((text,i)=>pieces.push({text,x:left*scaleX,y:20+i*14,top:8+i*14,width:(right-left)*scaleX,height:12,line:`${region}-plain-${i}`,confidence:0}))
                pageNotes.push('OCR returned text without word positions. It is retained in flowing text; source layout cannot be reconstructed for this page.')
              }
            }finally{crop.width=1;crop.height=1}
          }
          if(!pieces.length&&nativePieces.some(p=>/[\p{L}\p{N}]/u.test(p.text))&&!nativeText.includes('\ufffd')){
            pieces=nativePieces;ocrUnpositioned=true
            pageNotes.push('OCR returned no words after recovery; existing native PDF text was retained in flowing layout. Compare it with the source.')
          }
          const low=pieces.filter(w=>(w.confidence??100)<85)
          pageNotes.push(`Printed-text OCR: ${wordCount} words, ${low.length} flagged for review. Model score ${wordCount?Math.round(score/wordCount):0}/100 is not an accuracy percentage. Rendered at ${effectiveDpi} DPI using tessdata_best.`)
          if(low.length)pageNotes.push(`Examples: ${low.slice(0,15).map(w=>w.text).join(', ')}.`)
          if(!wordCount)pageNotes.push('No positioned OCR words after recovery. If no native/plain text is available, this page is retained as an image. Provide a clearer upright scan or check the selected language.')
        } else if(format!=='word-visual')pageNotes.push('Native text used. Text inside images and handwriting may be absent. Choose OCR every page for mixed/scanned content.')
        const rows=rowsFromPieces(pieces)
        if(!rows.length&&format!=='word-visual')pageNotes.push('No readable text extracted; source appearance retained when previews or visual Word are enabled.')
        const croppedRows=rows.filter(row=>row.y>=viewport.height*top/100&&row.y<=viewport.height*(1-bottom/100))
        const candidates=tables&&!rotated?inferTables(croppedRows):[]
        if(workbook&&summary){
          const textSheet=workbook.addWorksheet(`P${number}_Text`);textSheet.getColumn(1).width=110;textSheet.getColumn(1).alignment={wrapText:true,vertical:'top'}
          for(const section of textSections(pieces)){
            const text=safeText(section.paragraphs.map(paragraph=>paragraphPieces(paragraph).map(p=>p.text).join('')).join('\n'))
            // Excel itself limits a cell to 32,767 characters. Continue in another
            // cell instead of rejecting the file; don't split surrogate pairs.
            for(let start=0;start<text.length;){let end=Math.min(start+32767,text.length);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;textSheet.addRow([text.slice(start,end)]);start=end}
          }
          if(!rows.length)textSheet.addRow(['No extractable text. See the source preview.'])
          for(let t=0;t<candidates.length;t++){
            const sheet=workbook.addWorksheet(`P${number}_T${t+1}`)
            for(const row of candidates[t].rows)sheet.addRow(row.cells.map(c=>safeText(c.text)))
            sheet.eachRow(row=>row.eachCell(cell=>{cell.numFmt='@';cell.alignment={wrapText:true,vertical:'top'}}))
            sheet.columns.forEach(col=>{col.width=24})
          }
          pageNotes.push(candidates.length?'Table boundaries are heuristic. Verify every detected table against the page preview; merged cells are not inferred.':'No stable table candidate. Page text is retained; no page-wide columns were invented.')
          if(previews){
            const image=await getCanvas(),base64=image.toDataURL('image/png')
            const imageId=workbook.addImage({base64,extension:'png'})
            const sheet=workbook.addWorksheet(`P${number}_Preview`),scale=Math.min(1,1000/image.width)
            sheet.addImage(imageId,{tl:{col:0,row:0},ext:{width:image.width*scale,height:image.height*scale}})
          }
          summary.addRow([number,candidates.length,pageNotes.join(' ')])
        } else if(word){
          const children:InstanceType<typeof word.Paragraph>[]=[]
          const scale=Math.min(1,1584/Math.max(viewport.width,viewport.height))
          const width=viewport.width*scale,height=viewport.height*scale
          let flowing=false
          if(format==='word-visual'||!rows.length){
            const image=await getCanvas(),blob=await new Promise<Blob>((resolve,reject)=>image.toBlob(b=>b?resolve(b):reject(new Error('Could not create page image.')),'image/png'))
            const data=new Uint8Array(await blob.arrayBuffer())
            const fit=(height-4)/height
            children.push(new word.Paragraph({spacing:{before:0,after:0},children:[new word.ImageRun({type:'png',data,transformation:{width:width*fit*96/72,height:height*fit*96/72}})]}))
            if(!rows.length&&format==='word-editable')pageNotes.push('This page is an image in Word because editable text was unavailable.')
          }else if(shapes){
            const image=await getCanvas(),ctx=image.getContext('2d',{willReadFrequently:true})
            if(!ctx)throw new Error('Canvas unavailable.')
            const sx=image.width/viewport.width,sy=image.height/viewport.height
            for(const piece of pieces)Object.assign(piece,sampleColours(ctx,piece,sx,sy))
            const groups=textSections(pieces),boxes=sectionBoxes(groups,viewport.width,viewport.height)
            const estimates=boxes.map(b=>estimatedHeight(b.section,b.width,ctx,useOCR))
            // Word font metrics can differ from browser metrics. Reserve 15% headroom;
            // use body paragraphs if substantial shrinking or overlapping boxes are needed.
            const fits=boxes.map((b,i)=>Math.min(1,b.height/Math.max(1,estimates[i]*1.15)))
            flowing=ocrUnpositioned||wordLayout==='flow'||boxesOverlap(boxes)||fits.some(f=>f<.8)
            const runs:(InstanceType<typeof word.ImageRun>|InstanceType<typeof shapes.ShapeRun>)[]=[]
            if(graphics&&!flowing){
              const bg=document.createElement('canvas');canvases.push(bg);bg.width=image.width;bg.height=image.height
              const bgctx=bg.getContext('2d');if(!bgctx)throw new Error('Canvas unavailable.')
              if(useOCR){
                bgctx.drawImage(image,0,0)
                // Recognized scan text is removed with estimated panel colours. Unrecognized
                // text remains an image. This is not lossless image inpainting.
                for(const p of pieces){bgctx.fillStyle='#'+p.background;bgctx.fillRect(p.x*sx-1,(p.top??p.y-p.height)*sy-1,p.width*sx+2,p.height*sy+2)}
                pageNotes.push('Scan layout: recognized words are editable; their old pixels were covered using sampled background colours. Gradients, pictures and missed words may leave artifacts. Graphics remain images.')
              }else{
                const hidden=new Set([pdfjs.OPS.showText,pdfjs.OPS.showSpacedText,pdfjs.OPS.nextLineShowText,pdfjs.OPS.nextLineSetSpacingShowText])
                // PDF.js calls OperationsFilter with the operation index only.
                // Match annotation options so indexes refer to the same operator list.
                const operators=await wait(page.getOperatorList({annotationMode:pdfjs.AnnotationMode.DISABLE}));check()
                rendering.current=page.render({canvas:bg,canvasContext:bgctx,viewport:page.getViewport({scale:image.width/viewport.width}),annotationMode:pdfjs.AnnotationMode.DISABLE,operationsFilter:(i:number)=>!hidden.has(operators.fnArray[i])})
                await wait(rendering.current.promise);rendering.current=null;check()
                pageNotes.push('PDF graphics preserved as a background image, with editable positioned text. Text clipping effects and outlined lettering may differ.')
              }
              const blob=await new Promise<Blob>((resolve,reject)=>bg.toBlob(b=>b?resolve(b):reject(new Error('Page image failed.')),'image/png'))
              const data=new Uint8Array(await blob.arrayBuffer())
              runs.push(new word.ImageRun({type:'png',data,transformation:{width:width*96/72,height:height*96/72},floating:{horizontalPosition:{relative:word.HorizontalPositionRelativeFrom.PAGE,offset:0},verticalPosition:{relative:word.VerticalPositionRelativeFrom.PAGE,offset:0},behindDocument:true,allowOverlap:true,wrap:{type:word.TextWrappingType.NONE}}}))
              bg.width=1;bg.height=1
            }
            for(let bi=0;bi<boxes.length;bi++){
              const box=boxes[bi],group=box.section,factor=flowing?1:fits[bi]
              const paragraphs=group.paragraphs.map(paragraph=>{
                const base=paragraphFontSize(paragraph,useOCR)*scale*factor
                const textRuns=paragraphPieces(paragraph).map(p=>{
                  const font=pieceFont(p),size=Math.max(2,Math.round(base*2)),arabic=/[\u0600-\u06ff]/.test(p.text)
                  return new word.TextRun({text:safeText(p.text),font:{ascii:font,hAnsi:font,cs:font,eastAsia:font},size,sizeComplexScript:size,color:p.color??'000000',shading:flowing&&p.background?{fill:p.background}:undefined,bold:p.bold,italics:p.italic,rightToLeft:arabic,highlight:markUncertain&&(p.confidence??100)<85?'yellow':undefined})
                })
                // Every point is a paragraph inside ONE shared list box. Wrapped
                // continuation text remains inside its point, not in another box.
                return new word.Paragraph({spacing:{before:0,after:Math.round(base*4),line:276,lineRule:word.LineRuleType.AUTO},indent:group.list?{left:Math.round(base*20),hanging:Math.round(base*20)}:undefined,children:textRuns})
              })
              if(flowing)children.push(...paragraphs)
              else runs.push(new shapes.ShapeRun({type:'rectangle',fill:'none',line:{transparency:100,width:0},transformation:{width:box.width*scale*96/72,height:box.height*scale*96/72},floating:{horizontalPosition:{relative:word.HorizontalPositionRelativeFrom.PAGE,offset:Math.round(box.x*scale*12700)},verticalPosition:{relative:word.VerticalPositionRelativeFrom.PAGE,offset:Math.round(box.y*scale*12700)},allowOverlap:false,behindDocument:false,wrap:{type:word.TextWrappingType.NONE}},textOptions:{verticalAlignment:'top',margins:{top:0,bottom:0,left:0,right:0},wrap:true,shrinkTextOnOverflow:true},children:paragraphs}))
            }
            if(!flowing)children.push(new word.Paragraph({spacing:{before:0,after:0,line:20,lineRule:word.LineRuleType.EXACT},children:runs}))
            else pageNotes.push(wordLayout==='flow'?'Flowing Word paragraphs: text can expand and paginate. Source positions and page graphics are not retained.':'Automatic flow layout: source positions were unavailable, overlapping, or too small for the detected text. Paragraphs and lists now flow normally; source positions and page graphics are not retained on this page.')
            pageNotes.push('Editable sections with automatic wrapping, sampled colours and estimated font sizes. Paragraph boundaries are inferred; review complex columns and lists. Fonts are substituted (Nirmala UI for Bangla); install that font in Word. List items share a section. Tables are not reconstructed as native Word tables. Review all OCR, including unhighlighted words. Editing longer paragraphs can change their fit.')
          }

          sections.push({properties:{type:word.SectionType.NEXT_PAGE,page:{size:{width:Math.round(width*20),height:Math.round(height*20)},margin:{top:flowing?360:0,bottom:flowing?360:0,left:flowing?360:0,right:flowing?360:0,header:0,footer:0}}},children})
        }
        report.push(`Page ${number}: ${pageNotes.join(' ')}`)
        if(canvas){const release=canvas as HTMLCanvasElement;release.width=1;release.height=1}
        for(const released of canvases){released.width=1;released.height=1}
        canvases.length=0
        page.cleanup();check()
      }
      update('Building your download…');await yieldUI();check()
      let blob:Blob,extension:string
      if(workbook){const buffer=await wait(workbook.xlsx.writeBuffer());blob=new Blob([new Uint8Array(buffer)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});extension='xlsx'}
      else if(word){blob=await wait(word.Packer.toBlob(new word.Document({sections})));extension='docx'}
      else throw new Error('No output generated.')
      check();objectURL.current=URL.createObjectURL(blob)
      setResult({url:objectURL.current,name:file.name.replace(/\.pdf$/i,'')+`-converted.${extension}`})
      setNotes(report);setStatus('Ready. Review the conversion notes before using the result.')
    }catch(e){
      if(mounted.current){if(cancelled.current)setStatus('Cancelled.');else{const err=e as Error;setError(err.name==='PasswordException'?'Password required or incorrect password.':err.message||'Conversion failed. Try fewer pages or appearance-mode Word.');setStatus('')}}
    }finally{
      for(const canvas of canvases){canvas.width=1;canvas.height=1}
      try{await worker.current?.terminate()}catch{}worker.current=null
      operation.abort()
      try{await loading.current?.destroy()}catch{}
      loading.current=null;rendering.current=null;lock.current=false
      if(mounted.current)setBusy(false)
    }
  }
  return <section className="pse" aria-busy={busy}>
    <style>{CSS}</style>
    <header><h2>PDF converter</h2><p className="muted">Convert to Excel or editable Word. Your file stays in your browser.</p></header>
    <fieldset disabled={busy}>
      <label className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();choose(e.dataTransfer.files[0])}}>
        <strong>{file?.name??'Choose a PDF'}</strong>
        <span className="muted">{file?`${(file.size/1024/1024).toFixed(1)} MB · Click to change`:'or drop it here · no fixed page limit'}</span>
        <input type="file" aria-label="Choose PDF" accept="application/pdf,.pdf" onChange={e=>choose(e.target.files?.[0])}/>
      </label>
      <div className="grid">
        <div className="dropdown"><label>Convert to</label><CustomDropdown ariaLabel="Convert to" disabled={busy} value={format} onChange={value=>{reset();setFormat(value as Format)}} options={[{value:'excel',label:'Excel'},{value:'word-editable',label:'Word · editable paragraphs'},{value:'word-visual',label:'Word · original appearance'}]}/></div>
        {format!=='word-visual'&&<div className="dropdown"><label>Document language</label><CustomDropdown ariaLabel="Document language" disabled={busy} searchable value={language} onChange={value=>{reset();setLanguage(value)}} options={[{value:'ben+eng',label:'Bangla + English'},{value:'ben',label:'Bangla'},{value:'eng',label:'English'},{value:'hin+eng',label:'Hindi + English'},{value:'ara+eng',label:'Arabic + English'}]}/></div>}
      </div>
      <p className="hint">{format==='word-visual'?'Keeps the page design as images. Text is not editable.':format==='word-editable'?'Editable paragraphs with colours and approximate layout. Fonts may differ.':'Paragraphs, detected tables and page previews in separate sheets.'}</p>
      <details className="advanced"><summary>Advanced settings</summary>
        <div className="grid">
          <div className="dropdown"><label>Pages</label><CustomDropdown ariaLabel="Pages" disabled={busy} value={pageMode} onChange={value=>{reset();setPageMode(value as PageMode)}} options={[{value:'all',label:'All pages'},{value:'custom',label:'Selected pages'},{value:'except',label:'Exclude pages'}]}/></div>
          {pageMode!=='all'&&<label>Page range<input value={range} onChange={e=>{reset();setRange(e.target.value)}} placeholder="1-3, 5"/></label>}
          <label>Password <span className="muted">(optional)</span><input type="password" autoComplete="off" value={password} onChange={e=>{reset();setPassword(e.target.value)}}/></label>
          {format!=='word-visual'&&<>
            <div className="dropdown"><label>Text recognition</label><CustomDropdown ariaLabel="Text recognition" disabled={busy} value={ocr} onChange={value=>{reset();setOcr(value as typeof ocr)}} options={[{value:'auto',label:'Automatic'},{value:'always',label:'OCR every page'},{value:'off',label:'Native PDF text only'}]}/></div>
            <div className="dropdown"><label>OCR resolution</label><CustomDropdown disabled={busy} ariaLabel="OCR resolution" value={dpi} onChange={v=>{reset();setDpi(v)}} options={[{value:'300',label:'300 DPI · standard'},{value:'400',label:'400 DPI · small print'}]}/></div>
            <div className="dropdown"><label>Page layout</label><CustomDropdown disabled={busy} ariaLabel="Page layout" value={columns} onChange={v=>{reset();setColumns(v)}} options={[{value:'auto',label:'Automatic'},{value:'single',label:'One text block'},{value:'two',label:'Two equal columns'},{value:'three',label:'Three equal columns'}]}/></div>
          </>}
        </div>
        {format==='word-editable'&&<div className="checks"><div className="dropdown"><label>Word layout</label><CustomDropdown disabled={busy} ariaLabel="Word layout" value={wordLayout} onChange={value=>{reset();setWordLayout(value as 'source'|'flow')}} options={[{value:'source',label:'Source layout · auto-fit'},{value:'flow',label:'Flowing paragraphs · easier editing'}]}/></div><label><input type="checkbox" checked={graphics} onChange={e=>{reset();setGraphics(e.target.checked)}}/>Keep page graphics in source layout</label><label><input type="checkbox" checked={markUncertain} onChange={e=>{reset();setMarkUncertain(e.target.checked)}}/>Highlight uncertain OCR words</label><small>Scanned backgrounds are estimated and may have patches. Lists share one box. Pages with detected overlap or insufficient space use flowing text and omit the background; long edits may still change source layout. Open in desktop Word and review OCR.</small></div>}
        {format==='excel'&&<div className="checks"><label><input type="checkbox" checked={previews} onChange={e=>{reset();setPreviews(e.target.checked)}}/>Include page previews</label><label><input type="checkbox" checked={tables} onChange={e=>{reset();setTables(e.target.checked)}}/>Detect tables</label><div className="grid"><label>Exclude top % from tables<input type="number" min={0} max={40} value={top} onChange={e=>{reset();setTop(Number(e.target.value))}}/></label><label>Exclude bottom % from tables<input type="number" min={0} max={40} value={bottom} onChange={e=>{reset();setBottom(Number(e.target.value))}}/></label></div><small>Table structure is estimated. Numeric values stay as text; merged cells are not reconstructed.</small></div>}
        <small className="hint">No fixed file-size or page-count cap. Large conversions depend on browser memory and may need splitting. Use “OCR every page” for mixed image/text PDFs. Equal-column modes split at fixed positions. OCR requires review, especially handwriting.</small>
      </details>
    </fieldset>
    <div className="actions"><button className="primary" type="button" disabled={!file||busy} onClick={convert}>{busy?'Converting…':'Convert'}</button>{busy&&<button type="button" onClick={stop}>Cancel</button>}{result&&<a className="download" href={result.url} download={result.name}>Download {result.name.endsWith('.xlsx')?'Excel':'Word'}</a>}</div>
    {busy&&<progress aria-label="Converting PDF"/>}<p role="status">{status}</p>{error&&<p role="alert" className="notice error">{error}</p>}
    {!!notes.length&&<details className="review"><summary>Review notes · {notes.length} pages</summary><ul>{notes.map((note,i)=><li key={i}>{note}</li>)}</ul></details>}
    <footer>Processed locally. Internet is needed to load conversion tools and OCR models.</footer>
  </section>
}
