import type {CV,Education,Experience,JobAdvertisement,Profile} from './types';

type BackupPayload={
 format:'careermatch-backup-v1';
 profile:Partial<Profile>;
 cvs:CV[];
 jobs?:JobAdvertisement[];
};

const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const hasStrings=(value:Record<string,unknown>,keys:string[])=>keys.every(key=>typeof value[key]==='string');
const isExperience=(value:unknown):value is Experience=>isRecord(value)&&hasStrings(value,['id','title','organisation','dates','details']);
const isEducation=(value:unknown):value is Education=>isRecord(value)&&hasStrings(value,['id','qualification','institution','year']);

function isProfile(value:unknown,requireCollections:boolean):value is Profile{
 if(!isRecord(value)||!hasStrings(value,['id','name','email','phone','location','summary','skills','projects','certifications']))return false;
 if(requireCollections&&(!Array.isArray(value.experiences)||!Array.isArray(value.education)))return false;
 return (value.experiences===undefined||Array.isArray(value.experiences)&&value.experiences.every(isExperience))
  &&(value.education===undefined||Array.isArray(value.education)&&value.education.every(isEducation));
}

function isCv(value:unknown):value is CV{
 return isRecord(value)
  &&hasStrings(value,['id','title','jobTitle','company','createdAt','updatedAt','summary','jobDescription'])
  &&isProfile(value.profile,true)
  &&Array.isArray(value.selectedSkills)&&value.selectedSkills.every(skill=>typeof skill==='string')
  &&(value.selectedExperienceIds===undefined||Array.isArray(value.selectedExperienceIds)&&value.selectedExperienceIds.every(id=>typeof id==='string'))
  &&(value.selectedEducationIds===undefined||Array.isArray(value.selectedEducationIds)&&value.selectedEducationIds.every(id=>typeof id==='string'))
  &&['classic','modern','graduate'].includes(String(value.template));
}

function isJob(value:unknown):value is JobAdvertisement{
 return isRecord(value)
  &&hasStrings(value,['id','title','company','description','url','updatedAt'])
  &&['url','description','pdf','docx','txt'].includes(String(value.source))
  &&['pending','ready','failed'].includes(String(value.status))
  &&(value.location===undefined||typeof value.location==='string')
  &&(value.error===undefined||typeof value.error==='string');
}

export function isBackupPayload(value:unknown):value is BackupPayload{
 return isRecord(value)
  &&value.format==='careermatch-backup-v1'
  &&isProfile(value.profile,false)
  &&Array.isArray(value.cvs)&&value.cvs.every(isCv)
  &&(value.jobs===undefined||Array.isArray(value.jobs)&&value.jobs.every(isJob));
}
