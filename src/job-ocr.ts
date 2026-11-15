const MAX_FILE_SIZE=10*1024*1024;
const MAX_IMAGE_PIXELS=40_000_000;
const MAX_IMAGE_DIMENSION=2800;
const imageExtensions=new Set(['png','jpg','jpeg','webp']);
const imageTypes=new Set(['image/png','image/jpeg','image/webp']);

export type JobOcrSections={
 qualifications?:string;
 responsibilities?:string;
 experience?:string;
 requiredSkills?:string;
 requirements?:string;
};

export type JobOcrFields={title:string;company:string;location:string;sections:JobOcrSections};

export function isJobImageFile(file:File){
 const extension=file.name.split('.').pop()?.toLowerCase()||'';
 return imageExtensions.has(extension)||imageTypes.has(file.type.toLowerCase());
}

export function validateJobImageFile(file:File){
 if(file.size===0)throw new Error('The selected image is empty.');
 if(file.size>MAX_FILE_SIZE)throw new Error('Job advertisement images must be 10 MB or smaller.');
 if(!isJobImageFile(file))throw new Error('Choose a PNG, JPG, JPEG or WebP job advertisement image.');
}

function loadImage(file:File):Promise<HTMLImageElement>{
 const source=URL.createObjectURL(file);
 return new Promise<HTMLImageElement>((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>resolve(image);
  image.onerror=()=>reject(new Error('This image could not be opened. Try a PNG, JPG, JPEG or WebP screenshot.'));
  image.src=source;
 }).finally(()=>URL.revokeObjectURL(source));
}

function makeCanvas(image:HTMLImageElement){
 const width=image.naturalWidth;
 const height=image.naturalHeight;
 if(!width||!height)throw new Error('The selected image has no readable dimensions.');
 if(width*height>MAX_IMAGE_PIXELS)throw new Error('This image is too large to process safely. Use a screenshot under 40 megapixels.');
 const scale=Math.min(1,MAX_IMAGE_DIMENSION/Math.max(width,height));
 const canvas=document.createElement('canvas');
 canvas.width=Math.max(1,Math.round(width*scale));
 canvas.height=Math.max(1,Math.round(height*scale));
 const context=canvas.getContext('2d');
 if(!context)throw new Error('This browser cannot prepare the image for local OCR.');
 context.drawImage(image,0,0,canvas.width,canvas.height);
 return canvas;
}

function rotateCanvas(source:HTMLCanvasElement,degrees:number){
 const rotated=document.createElement('canvas');
 const swap=degrees%180!==0;
 rotated.width=swap?source.height:source.width;
 rotated.height=swap?source.width:source.height;
 const context=rotated.getContext('2d');
 if(!context)throw new Error('This browser cannot rotate the image for local OCR.');
 context.translate(rotated.width/2,rotated.height/2);
 context.rotate(degrees*Math.PI/180);
 context.drawImage(source,-source.width/2,-source.height/2);
 return rotated;
}

export async function extractJobTextFromImage(file:File,onProgress?:(progress:number)=>void):Promise<{text:string;confidence:number;quality:'good'|'low'}>{
 validateJobImageFile(file);
 const image=await loadImage(file);
 const canvas=makeCanvas(image);
 const initializeWorker=async()=>{
  const {createWorker}=await import('tesseract.js');
  return createWorker('eng',1,{
   workerPath:`${import.meta.env.BASE_URL}ocr/worker.min.js`,
   corePath:`${import.meta.env.BASE_URL}ocr/tesseract-core-lstm.wasm.js`,
   langPath:`${import.meta.env.BASE_URL}ocr`,
   cacheMethod:'write',
   workerBlobURL:false,
   gzip:true,
   logger:message=>{
    if(typeof message.progress==='number')onProgress?.(Math.round(message.progress*100));
   }
  });
 };
 let worker:Awaited<ReturnType<typeof initializeWorker>>;
 try{
  worker=await initializeWorker();
 }catch(error){
  const detail=error instanceof Error?error.message:'Unknown OCR initialization error';
  throw new Error(`Local OCR assets could not be loaded (${detail}). Open the app online once so its worker and language model can be cached, then retry.`,{cause:error});
 }
 try{
  let best=await worker.recognize(canvas);
  if(best.data.confidence<40||!best.data.text.trim()){
   for(const degrees of [90,180,270]){
    const candidate=await worker.recognize(rotateCanvas(canvas,degrees));
    const score=(result:{data:{text:string;confidence:number}})=>{
     const length=Math.min(result.data.text.trim().length,160);
     return result.data.confidence*(length/160);
    };
    if(score(candidate)>score(best))best=candidate;
   }
  }
  const text=best.data.text.trim();
  if(!text)throw new Error('No readable text was found. Try a clearer, upright screenshot with higher contrast.');
  return{text,confidence:best.data.confidence,quality:best.data.confidence<45||text.length<50?'low':'good'};
 }finally{
  await worker.terminate();
 }
}

const sectionPatterns:Record<keyof JobOcrSections,RegExp>={
 qualifications:/^(?:(?:minimum|required)\s+)?qualifications?(?:\s+and\s+experience)?\s*:?\s*$/i,
 responsibilities:/^(?:key\s+)?responsibilities(?:\s+and\s+duties)?\s*:?\s*$/i,
 experience:/^(?:(?:required|relevant)\s+)?experience\s*:?\s*$/i,
 requiredSkills:/^(?:(?:required|technical)\s+)?skills(?:\s+and\s+competencies)?\s*:?\s*$/i,
 requirements:/^(?:minimum|required|additional)?\s*requirements\s*:?\s*$/i
};

export function extractJobOcrFields(text:string):JobOcrFields{
 const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
 const valueFor=(pattern:RegExp)=>lines.find(line=>pattern.test(line))?.match(/^[^:–-]+[:–-]\s*(.+)$/)?.[1]?.trim()||'';
 const labelledTitle=valueFor(/^(?:job\s+title|position|role)\s*[:–-]/i);
 const firstHeading=lines.slice(0,2).find(line=>line.length<=100&&line.split(/\s+/).length>=2&&!/^[-*•]/.test(line)&&!/[:@]|www\.|https?:|apply\s+now|job\s+description|vacanc(?:y|ies)/i.test(line)&&!Object.values(sectionPatterns).some(pattern=>pattern.test(line)));
 const sections:JobOcrSections={};
 const keys=(Object.keys(sectionPatterns) as Array<keyof JobOcrSections>);
 for(let index=0;index<lines.length;index++){
  const key=keys.find(candidate=>sectionPatterns[candidate].test(lines[index]));
  if(!key||sections[key])continue;
  const next=lines.findIndex((line,lineIndex)=>lineIndex>index&&keys.some(candidate=>sectionPatterns[candidate].test(line)));
  const value=lines.slice(index+1,next<0?undefined:next).join('\n').trim();
  if(value)sections[key]=value;
 }
 return{
  title:labelledTitle||firstHeading||'',
  company:valueFor(/^(?:company|employer|organisation|organization)\s*[:–-]/i),
  location:valueFor(/^(?:(?:job|work)\s+)?location\s*[:–-]/i),
  sections
 };
}
