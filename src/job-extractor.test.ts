import {describe,expect,it,vi} from 'vitest';
import {validateJobUrl} from './job-extractor';

describe('job URL validation',()=>{
 it('accepts public HTTP and HTTPS URL syntax',()=>{
  expect(validateJobUrl('https://jobs.example/role')).toBe('https://jobs.example/role');
 });

 it('rejects non-web protocols and embedded credentials',()=>{
  expect(()=>validateJobUrl('file:///secret')).toThrow('HTTP or HTTPS');
  expect(()=>validateJobUrl('https://user:pass@jobs.example/role')).toThrow('embedded credentials');
 });

 it('posts URLs to a configured backend and rejects empty extraction results',async()=>{
  vi.stubEnv('VITE_JOB_EXTRACTION_ENDPOINT','https://api.example.test/job-extraction');
  const fetchMock=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({title:'Analyst',company:'Example Co',location:'Cape Town',description:'Excel reporting'})} as Response);
  vi.stubGlobal('fetch',fetchMock);
  vi.resetModules();
  try{
   const extractor=await import('./job-extractor');
   await expect(extractor.extractJobFromUrl('https://jobs.example/analyst')).resolves.toEqual({title:'Analyst',company:'Example Co',location:'Cape Town',description:'Excel reporting'});
   expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/job-extraction',expect.objectContaining({method:'POST',body:JSON.stringify({url:'https://jobs.example/analyst'})}));
   fetchMock.mockResolvedValueOnce({ok:true,status:200,json:async()=>({description:' '})} as Response);
   await expect(extractor.extractJobFromUrl('https://jobs.example/analyst')).rejects.toThrow('No job description was extracted');
   fetchMock.mockResolvedValueOnce({ok:false,status:422,json:async()=>({detail:{code:'extraction_failed',message:'No readable job description was found on this page.'}})} as Response);
   await expect(extractor.extractJobFromUrl('https://jobs.example/analyst')).rejects.toThrow('No readable job description was found on this page.');
   fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'));
   await expect(extractor.extractJobFromUrl('https://jobs.example/analyst')).rejects.toThrow('unreachable or blocked by browser CORS');
  }finally{
   vi.unstubAllGlobals();
   vi.unstubAllEnvs();
   vi.resetModules();
  }
 });

 it('does not use a local HTTP backend endpoint in production builds',async()=>{
  vi.stubEnv('PROD',true);
  vi.stubEnv('VITE_JOB_EXTRACTION_ENDPOINT','http://127.0.0.1:8000/api/job-extraction');
  vi.resetModules();
  try{
   const extractor=await import('./job-extractor');
   expect(extractor.isJobExtractionConfigured).toBe(false);
   await expect(extractor.extractJobFromUrl('https://jobs.example/analyst')).rejects.toThrow('not configured with a secure backend');
  }finally{
   vi.unstubAllEnvs();
   vi.resetModules();
  }
 });
});
