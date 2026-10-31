// Tests the real generator extracted from PdfEditor.tsx, without replacing its logic.
// Requires Poppler's pdftotext for an independent text/numeric check.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { PDFDocument, degrees, StandardFonts } = require('pdf-lib');
const sourceCode = fs.readFileSync('PdfEditor.tsx', 'utf8');
const core = sourceCode.slice(sourceCode.indexOf('  const settingsKey ='), sourceCode.indexOf('  const measureOutput ='));
const js = ts.transpileModule(core + '\nreturn { generatePdfBlob, settingsKey };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const factory = new Function('ctx', 'PDFDocument', 'degrees', `with(ctx) { ${js} }`);
const basePage = (fileId, index) => ({id:`${fileId}-${index}`,fileId,sourceIndex:index,url:'preview',originalUrl:'preview',brightness:0,contrast:0,saturation:0,hue:0,grayscale:false,sepia:0,sharpen:0,rotation:0,fineRotation:0,scale:1});
(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ['Invoice A 12345.67', 'Invoice B 98765.43']) doc.addPage([400, 600]).drawText(text, { font, x: 25, y: 500 });
  const bytes = await doc.save();
  const sources = { current: new Map([['a', {bytes,size:bytes.length,pdf:{numPages:2}}]]) };
  const pages = [basePage('a',0),basePage('a',1)];
  const context = overrides => ({ pages, signatures:[],watermarkText:'',watermarkPlacement:'center',watermarkOpacity:30,addPageNumbers:false,cleanWatermarks:false,enableCompression:false,compressionQuality:90,ppiMode:'300',customPPI:300,compressionGrayscale:false,allowRaster:false,encryptPassword:'',exportFormat:'pdf',numericCells:false,includeReferences:true,sources,exportCache:{current:null},setLoadingText:()=>{},yieldUI:async()=>{},renderPageToCanvas:()=>{throw Error('Unexpected rasterization')},...overrides });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'pdf-editor-test-'));
  const extract = async blob => { const file=path.join(temp,'output.pdf'); fs.writeFileSync(file,Buffer.from(await blob.arrayBuffer())); return execFileSync('pdftotext',[file,'-'],{encoding:'utf8'}); };
  try {
    const ctx = context({}); const engine = factory(ctx,PDFDocument,degrees);
    const unchanged = await engine.generatePdfBlob();
    assert.deepEqual(Buffer.from(await unchanged.arrayBuffer()),Buffer.from(bytes));
    assert.equal(await engine.generatePdfBlob(),unchanged); // same cached Blob, size and bytes
    assert.match(await extract(unchanged),/12345\.67/);
    const reordered = [basePage('a',1),basePage('a',0)]; reordered[0].rotation=90;
    const edited = await factory(context({pages:reordered}),PDFDocument,degrees).generatePdfBlob();
    const parsed=await PDFDocument.load(await edited.arrayBuffer());
    assert.equal(parsed.getPage(0).getRotation().angle,90);
    assert.equal(parsed.getPage(0).getWidth(),400);
    const text=await extract(edited); assert.match(text,/98765\.43/); assert.match(text,/12345\.67/);
    const split=await engine.generatePdfBlob([pages[1]]); const splitText=await extract(split);
    assert.match(splitText,/98765\.43/); assert.doesNotMatch(splitText,/12345\.67/);
    const dirty=[{...pages[0],brightness:20}];
    await assert.rejects(factory(context({pages:dirty}),PDFDocument,degrees).generatePdfBlob(),/need image mode/);
    await assert.rejects(factory(context({encryptPassword:'password'}),PDFDocument,degrees).generatePdfBlob(),/encryption is not supported/);
    const formDoc=await PDFDocument.create(); formDoc.addPage(); formDoc.getForm().createTextField('customer');
    const formBytes=await formDoc.save(); const formSources={current:new Map([['a',{bytes:formBytes,size:formBytes.length}]])};
    await assert.rejects(factory(context({pages:[pages[0]],sources:formSources}),PDFDocument,degrees).generatePdfBlob(),/form PDFs/);
    console.log('PASS: original-byte fallback; same-Blob cache; selectable numbers; reorder/rotate and dimensions; split text; filter refusal; encryption refusal; form refusal.');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
})();
