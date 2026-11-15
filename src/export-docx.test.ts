import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Buffer} from 'node:buffer';
import {inflateRawSync} from 'node:zlib';
import {createDocxDocument,exportDocx} from './export-docx';
import {download} from './export-shared';
import {emptyProfile,type CV,type Profile} from './types';
import {Packer} from 'docx';

vi.mock('./export-shared',async importOriginal=>{
 const actual=await importOriginal<typeof import('./export-shared')>();
 return {...actual,download:vi.fn()};
});

const profile:Profile={
 ...emptyProfile,
 name:'Sam Example',
 skills:'Excel, SQL',
 experiences:[
  {id:'exp-1',title:'Analyst',organisation:'Northwind',dates:'2022–2024',details:'Built reports.'},
  {id:'exp-2',title:'Volunteer',organisation:'Local group',dates:'2021',details:'Organised events.'}
 ],
 education:[
  {id:'edu-1',qualification:'Diploma',institution:'City College',year:'2021'},
  {id:'edu-2',qualification:'Certificate',institution:'Online Academy',year:'2020'}
 ],
 projects:'Built an offline reporting dashboard.',
 certifications:'Microsoft Excel Associate.'
};

const cv:CV={
 id:'cv-1',title:'Analyst CV',jobTitle:'Analyst',company:'Example Co',
 createdAt:'2026-01-01',updatedAt:'2026-01-01',profile,
 summary:'Experienced analyst.',selectedSkills:['Excel'],selectedExperienceIds:['exp-1'],
 selectedEducationIds:['edu-1'],template:'classic',jobDescription:'Do not export this job advertisement.'
};

async function documentXml(blob:Blob){
 const archive=Buffer.from(await blob.arrayBuffer());
 const footer=archive.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 let entry=archive.readUInt32LE(footer+16);
 const entries=archive.readUInt16LE(footer+10);
 for(let index=0;index<entries;index++){
  const nameLength=archive.readUInt16LE(entry+28);
  const extraLength=archive.readUInt16LE(entry+30);
  const commentLength=archive.readUInt16LE(entry+32);
  const name=archive.toString('utf8',entry+46,entry+46+nameLength);
  const compression=archive.readUInt16LE(entry+10);
  const compressedSize=archive.readUInt32LE(entry+20);
  const localHeader=archive.readUInt32LE(entry+42);
  if(name==='word/document.xml'){
   const localNameLength=archive.readUInt16LE(localHeader+26);
   const localExtraLength=archive.readUInt16LE(localHeader+28);
   const start=localHeader+30+localNameLength+localExtraLength;
   const compressed=archive.subarray(start,start+compressedSize);
   return (compression===0?compressed:inflateRawSync(compressed)).toString('utf8');
  }
  entry+=46+nameLength+extraLength+commentLength;
 }
 throw new Error('DOCX document.xml entry was not found.');
}

describe('DOCX export',()=>{
 beforeEach(()=>vi.mocked(download).mockClear());

 it('exports selected profile content and excludes unselected or job-ad content',async()=>{
  await exportDocx(cv);
  const [blob,name]=vi.mocked(download).mock.calls[0];
  const mammoth=await import('mammoth');
  const result=await mammoth.extractRawText({buffer:Buffer.from(await blob.arrayBuffer())});
  expect(name).toBe('Analyst_CV.docx');
  expect(result.value).toContain('Sam Example');
  expect(result.value).toContain('Experienced analyst.');
  expect(result.value).toContain('Built reports.');
  expect(result.value).toContain('Excel');
  expect(result.value).not.toContain('Volunteer');
  expect(result.value).not.toContain('Certificate');
  expect(result.value).not.toContain('Do not export this job advertisement.');
 });

 it('keeps section rules separate from heading text and links headings to their content',async()=>{
  const blob=await Packer.toBlob(createDocxDocument(cv));
  const xml=await documentXml(blob);
  const paragraphs=xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)??[];
  const expectedSections:[string,string][]=[
   ['PROFESSIONAL SUMMARY','Experienced analyst.'],
   ['SKILLS','Excel'],
   ['EXPERIENCE','Analyst'],
   ['EDUCATION','Diploma'],
   ['PROJECTS','Built an offline reporting dashboard.'],
   ['CERTIFICATIONS','Microsoft Excel Associate.']
  ];
  for(const [title,firstContent] of expectedSections){
   const headingIndex=paragraphs.findIndex(paragraph=>paragraph.includes(title));
   expect(headingIndex).toBeGreaterThanOrEqual(0);
   const heading=paragraphs[headingIndex];
   const rule=paragraphs[headingIndex+1];
   const content=paragraphs[headingIndex+2];
   expect(heading).toContain('<w:keepNext/>');
   expect(heading).not.toContain('<w:pBdr>');
   expect(rule).toContain('<w:top');
   expect(rule).toContain('<w:keepNext/>');
   expect(rule.replace(/<[^>]+>/g,'').trim()).toBe('');
   expect(content).toContain(firstContent);
   expect(content).not.toContain('<w:keepNext/>');
   expect(content).not.toContain('<w:keepLines/>');
  }
 });

 it('retains long content as a wrapping paragraph',async()=>{
  const longSummary='A source-supported skill statement '.repeat(80).trim();
  const blob=await Packer.toBlob(createDocxDocument({...cv,summary:longSummary}));
  const xml=await documentXml(blob);
  expect(xml).toContain(longSummary);
  expect(xml).not.toContain('<w:keepLines/>');
 });
});
