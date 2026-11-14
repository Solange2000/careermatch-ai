const MAX_FILE_SIZE=10*1024*1024;

export async function extractJobText(file:File):Promise<{text:string;format:'pdf'|'docx'|'txt'}>{
 if(file.size===0)throw new Error('The selected file is empty.');
 if(file.size>MAX_FILE_SIZE)throw new Error('Job advertisement files must be 10 MB or smaller.');
 const extension=file.name.split('.').pop()?.toLowerCase();
 let text:string;
 if(extension==='txt'){
  text=await file.text();
 }else if(extension==='pdf'){
  const pdfjs=await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
  const loadingTask=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())});
  try{
   const document=await loadingTask.promise;
   const pages:string[]=[];
   for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
    const page=await document.getPage(pageNumber);
    const content=await page.getTextContent();
    pages.push(content.items.map(item=>'str' in item?item.str:'').filter(Boolean).join(' '));
   }
   text=pages.join('\n');
  }finally{
   await loadingTask.destroy();
  }
 }else if(extension==='docx'){
  const mammoth=await import('mammoth');
  const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
  text=result.value;
 }else{
  throw new Error('Choose a PDF, DOCX or TXT job advertisement.');
 }
 if(!text.trim())throw new Error(extension==='pdf'?'No selectable text was found in this PDF. Scanned-image PDFs are not supported.':'No readable job description text was found.');
 return{text,format:extension as 'pdf'|'docx'|'txt'};
}
