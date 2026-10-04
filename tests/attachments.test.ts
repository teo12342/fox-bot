import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync} from 'node:zlib';
import {extractAttachment,AttachmentError} from '../apps/desktop/runtime/attachments';
const options={vision:true,maxCharacters:200000};
const input=(name:string,mime:string,bytes:Buffer)=>({id:'attachment-test',name,mime,bytes});
function crc32(bytes:Buffer){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
// Build actual standard ZIP fixtures, never fake yauzl or the document parser.
function zip(parts:Record<string,string|Buffer>,compress=false){const bodies:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const[name,value]of Object.entries(parts)){const raw=Buffer.isBuffer(value)?value:Buffer.from(value),data=compress?deflateRawSync(raw):raw,filename=Buffer.from(name);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(compress?8:0,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
 const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(compress?8:0,10);directory.writeUInt32LE(crc32(raw),16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(raw.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);bodies.push(local,filename,data);offset+=local.length+filename.length+data.length;
 }const entries=Object.keys(parts).length,footer=Buffer.alloc(22),directory=Buffer.concat(central);footer.writeUInt32LE(0x06054b50);footer.writeUInt16LE(entries,8);footer.writeUInt16LE(entries,10);footer.writeUInt32LE(directory.length,12);footer.writeUInt32LE(offset,16);return Buffer.concat([...bodies,directory,footer]);
}
const types='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>';
function pdf(text:string){const escaped=text.replace(/[()\\]/g,'\\$&'),stream=`BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let source='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(source));source+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(source);source+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(source);}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64');
test('UTF-8 text, code and CSV are bounded; public names never expose filesystem paths',async()=>{
 const result=await extractAttachment(input('C:\\Users\\private\\credentials\\report.csv','text/csv',Buffer.from('name,value\nfox,42')),options);
 assert.equal(result.name,'report.csv');assert.match((result.blocks[0] as any).text,/fox,42/);assert.ok(!JSON.stringify(result).includes('credentials'));
 const truncated=await extractAttachment(input('app.ts','text/plain',Buffer.from('export const value = 123;')),{...options,maxCharacters:6});assert.equal(truncated.truncated,true);assert.match((truncated.blocks[0] as any).text,/\[Attachment truncated\]/);
 await assert.rejects(extractAttachment(input('binary.txt','text/plain',Buffer.from([0,1,2,3])),options),{code:'BINARY_TEXT'});
 await assert.rejects(extractAttachment(input('bad.txt','text/plain',Buffer.from([255,254,255,254])),options),{code:'INVALID_TEXT'});
 await assert.rejects(extractAttachment(input('large.txt','text/plain',Buffer.from('12345')),{...options,maxBytes:4}),{code:'FILE_TOO_LARGE'});
 await assert.rejects(extractAttachment(input('app.txt','text/plain',Buffer.from('MZexecutable')),options),{code:'UNSUPPORTED_TYPE'});
 await assert.rejects(extractAttachment(input('app.txt','text/plain',Buffer.from('safe')),{...options,maxPixels:NaN}),{code:'INVALID_LIMIT'});
});
test('image blocks require real matching signatures and model vision; image metadata is removed',async()=>{
 const image=await extractAttachment(input('fox.png','image/png',png),options);assert.equal(image.blocks[1].type,'image_url');assert.match((image.blocks[1] as any).image_url.url,/^data:image\/png;base64,/);
 await assert.rejects(extractAttachment(input('fox.png','image/png',png),{vision:false}),{code:'VISION_UNAVAILABLE'});
 await assert.rejects(extractAttachment(input('fox.jpg','image/jpeg',png),options),{code:'MIME_MISMATCH'});
 await assert.rejects(extractAttachment(input('fox.png','image/png',Buffer.from('fake-image')),options),{code:'MIME_MISMATCH'});
 const data=Buffer.from('Comment\0C:\\Users\\private\\secret');const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write('tEXt',4);data.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);const withMetadata=Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]);
 const cleaned=await extractAttachment(input('fox.png','image/png',withMetadata),options);const bytes=Buffer.from((cleaned.blocks[1] as any).image_url.url.split(',')[1],'base64');assert.ok(!bytes.includes(Buffer.from('private')));assert.deepEqual(bytes,png);
 const huge=Buffer.from(png);huge.writeUInt32BE(100000,16);huge.writeUInt32BE(100000,20);await assert.rejects(extractAttachment(input('huge.png','image/png',huge),options),{code:'IMAGE_TOO_LARGE'});
});
test('real DOCX and PPTX extraction reads paragraphs, without document metadata',async()=>{
 const docx=zip({'[Content_Types].xml':types,'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fox report</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph</w:t></w:r></w:p></w:body></w:document>','docProps/core.xml':'<creator>C:\\Users\\private</creator>'});
 const result=await extractAttachment(input('report.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',docx),options);assert.match((result.blocks[0] as any).text,/Fox report\nSecond paragraph/);assert.ok(!JSON.stringify(result).includes('private'));
 const pptx=zip({'[Content_Types].xml':types,'ppt/slides/slide1.xml':'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>Fox presentation</a:t></a:r></a:p></p:sld>'});
 const slides=await extractAttachment(input('deck.pptx','application/octet-stream',pptx),options);assert.match((slides.blocks[0] as any).text,/Slide 1\nFox presentation/);
});
test('JPEG and WebP provider blocks use real images and remove identifying metadata',async()=>{
 const {createCanvas}=await import('@napi-rs/canvas');const canvas=createCanvas(2,2);const context=canvas.getContext('2d');context.fillStyle='orange';context.fillRect(0,0,2,2);
 const jpeg=canvas.toBuffer('image/jpeg');const metadata=Buffer.from('Exif\0\0C:\\Users\\private\\photo.jpg');const app1=Buffer.alloc(metadata.length+4);app1[0]=255;app1[1]=225;app1.writeUInt16BE(metadata.length+2,2);metadata.copy(app1,4);
 const image=await extractAttachment(input('fox.jpg','image/jpeg',Buffer.concat([jpeg.subarray(0,2),app1,jpeg.subarray(2)])),options);const clean=Buffer.from((image.blocks[1] as any).image_url.url.split(',')[1],'base64');assert.ok(!clean.includes(Buffer.from('private')));assert.deepEqual(clean,jpeg);
 const webp=canvas.toBuffer('image/webp');const result=await extractAttachment(input('fox.webp','image/webp',webp),options);assert.match((result.blocks[1] as any).image_url.url,/^data:image\/webp;base64,/);
});
test('real XLSX extracts shared strings, inline strings and cached formulas without evaluation',async()=>{
 const xlsx=zip({'[Content_Types].xml':types,'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml" Type="worksheet"/></Relationships>','xl/sharedStrings.xml':'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Fox</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c><c r="C1"><f>WEBSERVICE("https://never-fetch.example")</f><v>42</v></c></row></sheetData></worksheet>'});
 const result=await extractAttachment(input('budget.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xlsx),options);assert.match((result.blocks[0] as any).text,/Sheet: Budget\nFox\tRevenue\t42/);assert.ok(!JSON.stringify(result.blocks).includes('never-fetch'));
});
test('malicious Office archives reject traversal, entities, macros, bombs and type spoofing',async()=>{
 const unsafe=zip({'[Content_Types].xml':types,'../outside.xml':'bad'});await assert.rejects(extractAttachment(input('bad.docx','application/octet-stream',unsafe),options),AttachmentError);
 const entities=zip({'[Content_Types].xml':types,'word/document.xml':'<!DOCTYPE data [<!ENTITY exfil SYSTEM "file:///private">]><document>&exfil;</document>'});await assert.rejects(extractAttachment(input('bad.docx','application/octet-stream',entities),options),{code:'UNSAFE_XML'});
 const macros=zip({'[Content_Types].xml':types,'word/vbaProject.bin':'macro'});await assert.rejects(extractAttachment(input('bad.docx','application/octet-stream',macros),options),{code:'INVALID_ARCHIVE'});
 const bomb=zip({'[Content_Types].xml':types,'word/document.xml':'A'.repeat(200000)},true);await assert.rejects(extractAttachment(input('bomb.docx','application/octet-stream',bomb),options),{code:'INVALID_ARCHIVE'});
 await assert.rejects(extractAttachment(input('spoof.xlsx','application/pdf',zip({'[Content_Types].xml':types})),options),{code:'MIME_MISMATCH'});
 await assert.rejects(extractAttachment(input('empty.pdf','application/pdf',Buffer.alloc(0)),options),{code:'MIME_MISMATCH'});
});
test('PDF text is extracted in a bounded child process and malformed files fail explicitly', {timeout:20000},async()=>{
 const result=await extractAttachment(input('fox.pdf','application/pdf',pdf('Fox PDF content')),options);assert.match((result.blocks[0] as any).text,/Fox PDF content/);
 await assert.rejects(extractAttachment(input('bad.pdf','application/pdf',Buffer.from('%PDF-invalid garbage')),options),{code:'INVALID_PDF'});
 await assert.rejects(extractAttachment(input('audio.mp3','audio/mpeg',Buffer.from('not-audio')),options),{code:'UNSUPPORTED_TYPE'});
});
test('cancellation rejects pending PDF and archive extraction without doing model work',async()=>{
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(extractAttachment(input('app.txt','text/plain',Buffer.from('safe')),{...options,signal:cancelled.signal}),{code:'CANCELLED'});
 const pdfCancel=new AbortController();const parsing=extractAttachment(input('cancel.pdf','application/pdf',pdf('Cancelled')),{...options,signal:pdfCancel.signal});pdfCancel.abort();await assert.rejects(parsing,{code:'CANCELLED'});
 const zipCancel=new AbortController();const archive=extractAttachment(input('cancel.docx','application/octet-stream',zip({'[Content_Types].xml':types,'word/document.xml':'<document/>'})),{...options,signal:zipCancel.signal});zipCancel.abort();await assert.rejects(archive,{code:'CANCELLED'});
});

