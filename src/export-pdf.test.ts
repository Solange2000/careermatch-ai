import {beforeEach,describe,expect,it,vi} from 'vitest';
import {exportPdf} from './export-pdf';
import {emptyProfile,type CV,type Profile} from './types';

const output=vi.hoisted(()=>({texts:[] as {text:string;y:number}[],pages:0,saved:''}));

vi.mock('jspdf',()=>({jsPDF:class{
 internal={pageSize:{getHeight:()=>297}};
 setFont(){}
 setFontSize(){}
 setTextColor(){}
 splitTextToSize(text:string){return text.split('\n')}
 text(text:string|string[],_x:number,y:number){output.texts.push({text:Array.isArray(text)?text.join(' '):text,y})}
 setDrawColor(){}
 setLineWidth(){}
 line(){}
 addPage(){output.pages++;return this}
 save(name:string){output.saved=name;return this}
}}));

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

describe('PDF export',()=>{
 beforeEach(()=>{output.texts.length=0;output.pages=0;output.saved=''});

 it('exports selected profile content and excludes unselected or job-ad content',()=>{
  exportPdf(cv);
  const rendered=output.texts.map(call=>call.text).join(' ');
  expect(rendered).toContain('Experienced analyst.');
  expect(rendered).toContain('Built reports.');
  expect(rendered).toContain('Excel');
  expect(rendered).not.toContain('Volunteer');
  expect(rendered).not.toContain('Certificate');
  expect(rendered).not.toContain('Do not export this job advertisement.');
  expect(output.saved).toBe('Analyst_CV.pdf');
 });

 it('keeps a section heading with its first line across a page break',()=>{
  const longSummary=Array.from({length:46},(_,index)=>`Evidence line ${index+1}`).join('\n');
  exportPdf({...cv,summary:longSummary});
  const skillsIndex=output.texts.findIndex(call=>call.text==='SKILLS');
  expect(skillsIndex).toBeGreaterThanOrEqual(0);
  expect(output.texts[skillsIndex].y).toBeLessThan(30);
  expect(output.texts[skillsIndex+1].text).toBe('Excel');
  expect(output.texts[skillsIndex+1].y).toBeLessThan(40);
  expect(output.pages).toBeGreaterThan(0);
 });
});
