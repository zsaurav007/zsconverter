/** Local-only PDF → editable Office. No network requests, credentials or server route. */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

export type OfficeOptions = {
  format: 'docx' | 'xlsx'; numericCells: boolean; includeReferences: boolean;
  onProgress: (message: string) => void; signal?: AbortSignal;
};
export type OfficeSpan = {
  text: string; x: number; y: number; width: number; height: number;
  fontSize: number; font: string; bold: boolean; italic: boolean; color: string;
};
export type OfficePage = { width: number; height: number; spans: OfficeSpan[]; background?: Uint8Array; reference?: Uint8Array };
export type OfficeResult = { blob: Blob; warnings: string[]; pages: number; textItems: number };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const check = (signal?: AbortSignal) => { if (signal?.aborted) throw new Error('Conversion cancelled.'); };
const MAX_CANVAS = 24000000;
const normalize = (text: string) => text.normalize('NFKC').replace(/\s/g, '');
const plainObject = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};

async function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Page image encoding failed.')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
async function render(page: PDFPageProxy, dpi: number, filter?: (index: number) => boolean): Promise<Uint8Array> {
  const view = page.getViewport({ scale: dpi / 72 });
  if (view.width * view.height > MAX_CANVAS) throw new Error('Page is too large for safe local conversion. Split or resize this document first.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
  const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas is unavailable in this browser.');
  try {
    await page.render({ canvas, canvasContext: context, viewport: view, operationsFilter: filter, annotationMode: 0 }).promise;
    return await canvasBytes(canvas);
  } finally { canvas.width = 0; canvas.height = 0; }
}

/** Uses PDF.js operators only to identify text painting and its fill color; never parses PDF bytes. */
export async function extractOfficePages(pdf: PDFDocumentProxy, options: OfficeOptions): Promise<{ pages: OfficePage[]; warnings: string[] }> {
  const { OPS, Util } = await import('pdfjs-dist');
  const warnings = new Set<string>();
  warnings.add('Fonts may be substituted by Word/Excel. Check line breaks, spacing and all numbers against the PDF.');
  const pages: OfficePage[] = [];
  if (pdf.numPages > 100) throw new Error('Local conversion supports up to 100 pages per job. Split this document first.');
  for (let index = 1; index <= pdf.numPages; index++) {
    check(options.signal); options.onProgress(`Reading text and layout ${index}/${pdf.numPages}…`); await tick();
    const page = await pdf.getPage(index);
    try {
      const viewport = page.getViewport({ scale: 1 });
      if (viewport.width > 1584 || viewport.height > 1584) throw new Error(`Page ${index} exceeds Word's 22-inch page limit.`);
      const content = await page.getTextContent();
      const textItems = content.items.filter(item => 'str' in item && item.str.trim());
      if (!textItems.length) throw new Error(`Page ${index} has no readable text layer (a scan, image or outlined text). This version cannot turn it into a reliable editable replica. Use OCR first and review its recognition.`);
      const operators = await page.getOperatorList({ annotationMode: 0 });
      const textOps = new Set<number>([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
      let fill = '000000'; const stack: string[] = [];
      let glyphText = ''; const glyphColors: string[] = [];
      for (let i = 0; i < operators.fnArray.length; i++) {
        const op = operators.fnArray[i]; const args: unknown[] = operators.argsArray[i] ?? [];
        if (op === OPS.save) stack.push(fill);
        if (op === OPS.restore) fill = stack.pop() ?? '000000';
        if (op === OPS.setFillRGBColor && typeof args[0] === 'string') fill = args[0].replace('#', '').toUpperCase();
        if (op === OPS.setTextRenderingMode && args[0] !== 0) throw new Error(`Page ${index} uses invisible, stroked or clipping text. Its design cannot be safely reconstructed by this local converter.`);
        if (textOps.has(op)) {
          const glyphs: unknown[] = Array.isArray(args[0]) ? args[0] : [];
          for (const glyph of glyphs) {
            const text = plainObject(glyph).unicode;
            if (typeof text === 'string') {
              const normalized = normalize(text); glyphText += normalized;
              for (let j = 0; j < normalized.length; j++) glyphColors.push(fill);
            }
          }
        }
      }
      // Render graphics WITHOUT PDF text. Original text is rebuilt as real Word text.
      options.onProgress(`Preparing graphics ${index}/${pdf.numPages}…`);
      const background = options.format === 'docx' ? await render(page, 200, i => !textOps.has(operators.fnArray[i])) : undefined;
      const reference = options.format === 'xlsx' && options.includeReferences ? await render(page, 144) : undefined;
      const spans: OfficeSpan[] = [];
      let textCursor = 0;
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        if (/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(item.str)) throw new Error(`Page ${index} contains missing or invalid character mappings. Editable text would be unreliable.`);
        const style = content.styles[item.fontName];
        const matrix = Util.transform(viewport.transform, item.transform);
        const angle = Math.atan2(matrix[1], matrix[0]);
        if (style?.vertical || Math.abs(angle) > 0.015 || Math.abs(matrix[2]) > Math.max(0.1, Math.abs(matrix[3]) * 0.015)) throw new Error(`Page ${index} contains rotated or skewed text. Reset rotation or keep this page as PDF; a matching editable layout is not supported.`);
        const height = Math.hypot(matrix[2], matrix[3]);
        if (!Number.isFinite(height) || height < 0.1) continue;
        const ascent = typeof style?.ascent === 'number' ? style.ascent : 0.8;
        let fontInfo: Record<string, unknown> = {};
        try { fontInfo = plainObject(page.commonObjs.get(item.fontName)); } catch { /* Font may not be loaded for spreadsheet extraction. */ }
        const sourceName = typeof fontInfo.name === 'string' ? fontInfo.name.replace(/^[A-Z]{6}\+/, '') : style?.fontFamily ?? 'Arial';
        const bengali = /[\u0980-\u09FF]/.test(item.str);
        const font = bengali ? 'Nirmala UI' : /times|serif/i.test(sourceName) && !/sans/i.test(sourceName) ? 'Times New Roman' : /courier|mono/i.test(sourceName) ? 'Courier New' : 'Arial';
        const normalized = normalize(item.str);
        const match = glyphText.indexOf(normalized, textCursor);
        let color = '000000';
        if (match >= 0) { color = glyphColors[match] ?? color; textCursor = match + normalized.length; }
        else warnings.add(`Page ${index}: some text colors could not be mapped and use black.`);
        spans.push({ text: item.str, x: matrix[4], y: matrix[5] - height * ascent,
          width: Math.max(0.5, item.width), height, fontSize: height, font,
          bold: fontInfo.bold === true || /bold|black|heavy/i.test(sourceName), italic: fontInfo.italic === true || /italic|oblique/i.test(sourceName),
          color: /^[\dA-F]{6}$/.test(color) ? color : '000000' });
      }
      if (spans.length > 15000) throw new Error(`Page ${index} is too complex for editable conversion in this browser.`);
      if (spans.some(s => s.x < -1 || s.y < -1 || s.x + s.width > viewport.width + 3 || s.y + s.height > viewport.height + 3)) throw new Error(`Page ${index} has clipped or out-of-page text. Keeping it inside Word/Excel would change the design.`);
      pages.push({ width: viewport.width, height: viewport.height, spans, background, reference });
      check(options.signal);
    } finally { page.cleanup(); }
  }
  return { pages, warnings: [...warnings] };
}

export type OfficeRow = { y: number; height: number; cells: OfficeSpan[] };
/** Minimal geometric grouping on top of PDF.js extraction; no inferred values or formulas. */
export function groupRows(spans: OfficeSpan[]): OfficeRow[] {
  const rows: OfficeRow[] = [];
  for (const span of [...spans].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find(r => Math.abs(r.y - span.y) <= Math.min(3, span.fontSize * 0.25));
    if (!row) { row = { y: span.y, height: span.height, cells: [] }; rows.push(row); }
    row.height = Math.max(row.height, span.height); row.cells.push({ ...span });
  }
  for (const row of rows) {
    const cells: OfficeSpan[] = [];
    for (const span of row.cells.sort((a, b) => a.x - b.x)) {
      const previous = cells[cells.length - 1];
      const gap = previous ? span.x - (previous.x + previous.width) : Infinity;
      if (previous && gap >= -1 && gap < Math.max(2, Math.min(previous.fontSize, span.fontSize) * 0.55)) {
        const join = gap > Math.min(span.fontSize, previous.fontSize) * 0.15 && !/\s$/.test(previous.text) && !/^\s/.test(span.text) ? ' ' : '';
        previous.text += join + span.text;
        previous.width = Math.max(previous.width, span.x + span.width - previous.x);
      } else cells.push(span);
    }
    row.cells = cells;
  }
  return rows;
}

export function excelValue(text: string, numeric: boolean): { value: string | number; format: string } {
  // Keep identifiers, leading zeros, >15 digits, commas, scientific notation and formulas as literal text.
  if (numeric && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) && text.replace(/[-.]/g, '').length <= 15 && !/^-0(?:\.0+)?$/.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value)) return { value, format: text.includes('.') ? '0.' + '0'.repeat(text.split('.')[1].length) : '0' };
  }
  return { value: text, format: '@' };
}

export async function writeWord(pages: OfficePage[], options: OfficeOptions): Promise<Blob> {
  const d = await import('docx');
  const sections: import('docx').ISectionOptions[] = [];
  for (let i = 0; i < pages.length; i++) {
    check(options.signal); options.onProgress(`Building editable Word page ${i + 1}/${pages.length}…`); await tick();
    const page = pages[i]; const children: import('docx').Paragraph[] = [];
    if (page.background) children.push(new d.Paragraph({ spacing: { before: 0, after: 0, line: 1, lineRule: d.LineRuleType.EXACT }, children: [new d.ImageRun({
      type: 'png', data: page.background, transformation: { width: page.width * 4 / 3, height: page.height * 4 / 3 },
      floating: { horizontalPosition: { relative: d.HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: d.VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, allowOverlap: true, wrap: { type: d.TextWrappingType.NONE } },
    })] }));
    for (const span of page.spans) {
      const width = Math.max(1, Math.min(page.width - span.x, span.width + 3));
      children.push(new d.Paragraph({
        frame: { type: 'absolute', position: { x: Math.round(span.x * 20), y: Math.round(span.y * 20) }, width: Math.round(width * 20), height: Math.round(span.height * 1.4 * 20),
          anchor: { horizontal: d.FrameAnchorType.PAGE, vertical: d.FrameAnchorType.PAGE }, wrap: d.FrameWrap.NONE, rule: d.HeightRule.ATLEAST, space: { horizontal: 0, vertical: 0 } },
        spacing: { before: 0, after: 0, line: Math.round(span.height * 20), lineRule: d.LineRuleType.EXACT },
        children: [new d.TextRun({ text: span.text, font: span.font, size: Math.max(1, Math.round(span.fontSize * 2)), sizeComplexScript: Math.max(1, Math.round(span.fontSize * 2)),
          bold: span.bold, italics: span.italic, color: span.color, fitText: { width: Math.round(span.width * 20) } })],
      }));
    }
    // End each section with an in-flow anchor so its frames cannot migrate to the following page.
    children.push(new d.Paragraph({ children: [new d.TextRun({ text: '', size: 1 })], spacing: { before: 0, after: 0, line: 1, lineRule: d.LineRuleType.EXACT } }));
    sections.push({ properties: { type: d.SectionType.NEXT_PAGE, page: { size: { width: Math.round(page.width * 20), height: Math.round(page.height * 20) }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } }, children });
  }
  const doc = new d.Document({ creator: 'PDF Editor', description: 'Locally reconstructed editable text. Review against the original PDF.', sections });
  options.onProgress('Packaging Word document…'); await tick();
  const blob = await d.Packer.toBlob(doc); check(options.signal); return blob;
}

export async function writeExcel(pages: OfficePage[], options: OfficeOptions): Promise<Blob> {
  const module = await import('exceljs');
  const Excel = module.default;
  const workbook = new Excel.Workbook(); workbook.creator = 'PDF Editor';
  for (let i = 0; i < pages.length; i++) {
    check(options.signal); options.onProgress(`Building editable worksheet ${i + 1}/${pages.length}…`); await tick();
    const page = pages[i]; const rows = groupRows(page.spans);
    const sheet = workbook.addWorksheet(`Page ${i + 1}`, { views: [{ showGridLines: false }], pageSetup: { orientation: page.width > page.height ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9, margins: { left: 0.15, right: 0.15, top: 0.15, bottom: 0.15, header: 0, footer: 0 } } });
    // Use all cell starts, clustered within 2 pt, to preserve column positions without inventing table semantics.
    const boundaries = [0];
    for (const x of rows.flatMap(row => row.cells.map(cell => cell.x)).sort((a, b) => a - b)) if (x > boundaries[boundaries.length - 1] + 2) boundaries.push(x);
    boundaries.push(page.width);
    if (boundaries.length > 257 || rows.length > 5000) throw new Error(`Page ${i + 1} has too many geometric columns/rows for a reliable spreadsheet.`);
    for (let c = 0; c < boundaries.length - 1; c++) sheet.getColumn(c + 1).width = Math.max(0.2, (boundaries[c + 1] - boundaries[c]) * 4 / 3 / 7);
    let rowIndex = 1; let bottom = 0;
    for (const row of rows) {
      const gap = row.y - bottom;
      if (gap > 2) { sheet.getRow(rowIndex).height = Math.min(409, gap); rowIndex++; }
      const excelRow = sheet.getRow(rowIndex); excelRow.height = Math.min(409, row.height * 1.3);
      const occupied = new Set<number>();
      for (let j = 0; j < row.cells.length; j++) {
        const span = row.cells[j];
        let start = 0;
        for (let c = 0; c < boundaries.length - 1; c++) if (boundaries[c] <= span.x + 2) start = c;
        let end = start;
        const maxX = Math.min(span.x + span.width, row.cells[j + 1]?.x ?? page.width);
        while (end + 1 < boundaries.length - 1 && boundaries[end + 1] < maxX - 2) end++;
        if (occupied.has(start)) throw new Error(`Page ${i + 1} has overlapping text cells that cannot be safely assigned to Excel.`);
        for (let c = start; c <= end; c++) occupied.add(c);
        if (end > start) sheet.mergeCells(rowIndex, start + 1, rowIndex, end + 1);
        const cell = sheet.getCell(rowIndex, start + 1); const value = excelValue(span.text, options.numericCells);
        cell.value = value.value; cell.numFmt = value.format;
        cell.font = { name: span.font, size: span.fontSize, bold: span.bold, italic: span.italic, color: { argb: `FF${span.color}` } };
        cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: false, shrinkToFit: false };
      }
      bottom = row.y + excelRow.height; rowIndex++;
    }
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(boundaries.length - 1).letter}${rowIndex}`;
    if (page.reference) {
      const reference = workbook.addWorksheet(`Reference ${i + 1}`);
      reference.getCell('A1').value = 'Original PDF appearance — reference image only. Editable values are on the Page sheet.';
      reference.getColumn(1).width = 110;
      const imageId = workbook.addImage({ buffer: page.reference as unknown as import('exceljs').Buffer, extension: 'png' });
      reference.addImage(imageId, { tl: { col: 0, row: 2 }, ext: { width: page.width * 4 / 3, height: page.height * 4 / 3 } });
    }
  }
  options.onProgress('Packaging Excel workbook…'); await tick();
  const bytes = await workbook.xlsx.writeBuffer(); check(options.signal);
  return new Blob([Uint8Array.from(new Uint8Array(bytes)).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function convertPdfToOffice(pdf: PDFDocumentProxy, options: OfficeOptions): Promise<OfficeResult> {
  const { pages, warnings } = await extractOfficePages(pdf, options);
  if (options.format === 'docx') warnings.push('Word uses editable positioned text and a separate graphics layer. Graphics remain images; native Word tables and paragraph reflow are not reconstructed.');
  else warnings.push('Excel rows/columns are inferred from positions. Borders, illustrations, merged-cell meaning and formulas are not reconstructed. Reference sheets preserve the source appearance for checking.');
  const blob = options.format === 'docx' ? await writeWord(pages, options) : await writeExcel(pages, options);
  return { blob, warnings, pages: pages.length, textItems: pages.reduce((n, page) => n + page.spans.length, 0) };
}
