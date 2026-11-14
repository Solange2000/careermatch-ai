import {describe,expect,it} from 'vitest';
import {refreshCvFromProfile,sections} from './cv-content';
import {emptyProfile,type CV,type Profile} from './types';

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
 createdAt:'2026-01-01',updatedAt:'2026-01-01',profile:structuredClone(profile),
 summary:'Experienced analyst.',selectedSkills:['Excel'],selectedExperienceIds:['exp-1'],
 selectedEducationIds:['edu-1'],template:'modern',jobDescription:'Excel reporting'
};

describe('CV content',()=>{
 it('includes only selected profile evidence in generated sections',()=>{
  const content=sections(cv);
  expect(content.find(section=>section.title==='EXPERIENCE')?.lines).toEqual(['Analyst — Northwind — 2022–2024','Built reports.']);
  expect(content.find(section=>section.title==='EDUCATION')?.lines).toEqual(['Diploma — City College — 2021']);
  expect(content.find(section=>section.title==='SKILLS')?.lines).toEqual(['Excel']);
 });

 it('refreshes passport data while preserving CV-specific edits and valid selections',()=>{
  const updatedProfile={...profile,location:'Cape Town',experiences:[profile.experiences[0],{id:'exp-3',title:'New role',organisation:'New Co',dates:'2025',details:'Verified work.'}],education:[profile.education[0]]};
  const refreshed=refreshCvFromProfile({...cv,title:'My edited CV',summary:'My edited summary.',selectedSkills:['Excel','Custom profile note']},updatedProfile);
  expect(refreshed).toMatchObject({title:'My edited CV',summary:'My edited summary.',template:'modern',selectedSkills:['Excel','Custom profile note']});
  expect(refreshed.profile.location).toBe('Cape Town');
  expect(refreshed.selectedExperienceIds).toEqual(['exp-1']);
  expect(refreshed.selectedEducationIds).toEqual(['edu-1']);
  expect(refreshed.profile).not.toBe(updatedProfile);
 });
});
