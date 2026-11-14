import {describe,expect,it} from 'vitest';
import {makeSummary} from './matcher';
import {emptyProfile} from './types';

describe('CV summary generation',()=>{
 it('uses only matching Career Passport evidence when no user summary exists',()=>{
  const summary=makeSummary(emptyProfile,'Analyst',[
   {term:'Excel',matched:true,source:'Present in your Career Passport'},
   {term:'SQL',matched:false,source:'No evidence found in your Career Passport'}
  ]);
  expect(summary).toBe('Career Passport evidence matching this role: Excel.');
  expect(summary).not.toMatch(/motivated|eager|experienced|expert/i);
 });

 it('leaves the summary blank rather than inventing personal traits',()=>{
  expect(makeSummary(emptyProfile,'Analyst',[])).toBe('');
 });
});
