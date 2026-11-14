import {describe,expect,it} from 'vitest';
import {isBackupPayload} from './backup-validation';
import {emptyProfile,type CV,type JobAdvertisement,type Profile} from './types';

const profile:Profile={...emptyProfile,name:'Sam Example',skills:'Excel'};
const cv:CV={
 id:'cv-1',title:'Analyst CV',jobTitle:'Analyst',company:'Example Co',
 createdAt:'2026-01-01',updatedAt:'2026-01-01',profile,summary:'',
 selectedSkills:['Excel'],selectedExperienceIds:[],selectedEducationIds:[],
 template:'classic',jobDescription:'Excel reporting'
};
const job:JobAdvertisement={
 id:'job-1',title:'Analyst',company:'Example Co',description:'Excel reporting',
 url:'https://example.com/job',source:'url',status:'ready',updatedAt:'2026-01-01'
};

describe('backup validation',()=>{
 it('accepts a complete application backup',()=>{
  expect(isBackupPayload({format:'careermatch-backup-v1',profile,cvs:[cv],jobs:[job]})).toBe(true);
 });

 it('rejects malformed saved records before restore can write them',()=>{
  expect(isBackupPayload({format:'careermatch-backup-v1',profile,cvs:[{id:'bad'}],jobs:[]})).toBe(false);
  expect(isBackupPayload({format:'careermatch-backup-v1',profile,cvs:[],jobs:[{id:'bad'}]})).toBe(false);
 });
});
