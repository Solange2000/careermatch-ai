import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Buffer} from 'node:buffer';
import {exportDocx} from './export-docx';
import {download} from './export-shared';
import {emptyProfile,type CV,type Profile} from './types';

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
 ]
};

const cv:CV={
 id:'cv-1',title:'Analyst CV',jobTitle:'Analyst',company:'Example Co',
 createdAt:'2026-01-01',updatedAt:'2026-01-01',profile,
 summary:'Experienced analyst.',selectedSkills:['Excel'],selectedExperienceIds:['exp-1'],
 selectedEducationIds:['edu-1'],template:'classic',jobDescription:'Do not export this job advertisement.'
};

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
});
