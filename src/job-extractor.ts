export type ExtractedJob={title?:string;company?:string;location?:string;description:string};

const configuredEndpoint=import.meta.env.VITE_JOB_EXTRACTION_ENDPOINT?.trim();
const endpoint=(()=>{if(!configuredEndpoint)return undefined;try{const url=new URL(configuredEndpoint);const secure=url.protocol==='https:';const localHttp=!import.meta.env.PROD&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);return secure||localHttp?url.toString():undefined}catch{return undefined}})();
export const isJobExtractionConfigured=Boolean(endpoint);

export function validateJobUrl(value:string):string{
 let url:URL;
 try{url=new URL(value.trim())}catch{throw new Error('Enter a complete job advertisement URL.')}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use a valid HTTP or HTTPS job URL without embedded credentials.');
 return url.toString();
}

export async function extractJobFromUrl(value:string):Promise<ExtractedJob>{
 if(!endpoint)throw new Error('Online URL extraction is not configured with a secure backend. The link is saved locally; paste the description or configure a secure backend.');
 const url=validateJobUrl(value);
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),20000);
 try{
  let response:Response;
  try{
   response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url}),signal:controller.signal});
  }catch(error){
   if(controller.signal.aborted)throw new Error('The extraction service timed out. Your saved URL is unchanged.');
   if(error instanceof TypeError)throw new Error('The extraction service is unreachable or blocked by browser CORS policy. Your saved URL is unchanged.');
   throw error;
  }
  if(response.status===401||response.status===403)throw new Error('The extraction service rejected the request. The source may require sign-in or may not permit extraction.');
  if(response.status===404||response.status===415)throw new Error('This URL is unsupported or its contents are inaccessible.');
  if(response.status===429)throw new Error('The extraction service is temporarily rate-limited. Try again later.');
  if(!response.ok){
   let result:unknown;
   try{result=await response.json()}catch{result=undefined}
   const detail=result&&typeof result==='object'?(result as Record<string,unknown>).detail:undefined;
   const message=detail&&typeof detail==='object'?(detail as Record<string,unknown>).message:undefined;
   if(typeof message==='string'&&message.trim())throw new Error(message.trim());
   throw new Error(`The extraction service returned an error (${response.status}).`);
  }
  let result:unknown;
  try{result=await response.json()}catch{throw new Error('The extraction service returned an unreadable response.')}
  if(!result||typeof result!=='object')throw new Error('The extraction service returned an invalid response.');
  const data=result as Record<string,unknown>;
  if(typeof data.description!=='string'||!data.description.trim())throw new Error('No job description was extracted. The website may block access, require sign-in, or provide no readable job text.');
  return{
   title:typeof data.title==='string'?data.title.trim():undefined,
   company:typeof data.company==='string'?data.company.trim():undefined,
   ...(typeof data.location==='string'?{location:data.location.trim()}:{}),
   description:data.description.trim()
  };
 }finally{
  clearTimeout(timeout);
 }
}
