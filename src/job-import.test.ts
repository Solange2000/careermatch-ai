import {describe,expect,it} from 'vitest';
import {extractJobText} from './job-import';

describe('job advertisement file import',()=>{
 it('reads TXT files without network access',async()=>{
  const result=await extractJobText(new File(['Verified responsibilities'],'role.txt',{type:'text/plain'}));
  expect(result).toEqual({format:'txt',text:'Verified responsibilities'});
 });

 it('rejects unsupported and empty files with clear errors',async()=>{
  await expect(extractJobText(new File(['data'],'role.html',{type:'text/html'}))).rejects.toThrow('Choose a PDF, DOCX or TXT');
  await expect(extractJobText(new File([],'empty.txt',{type:'text/plain'}))).rejects.toThrow('file is empty');
 });
});
