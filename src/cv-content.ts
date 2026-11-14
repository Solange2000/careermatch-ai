import type {CV,Profile} from './types';

export function sections(cv:CV){
 const p=cv.profile;
 const experiences=p.experiences.filter(e=>cv.selectedExperienceIds?.includes(e.id)??true);
 const education=p.education.filter(e=>cv.selectedEducationIds?.includes(e.id)??true);
 return [
  {title:'PROFESSIONAL SUMMARY',lines:[cv.summary]},
  {title:'SKILLS',lines:[cv.selectedSkills.join(' • ')]},
  {title:'EXPERIENCE',lines:experiences.flatMap(e=>[[e.title,e.organisation,e.dates].filter(Boolean).join(' — '),e.details].filter(line=>line.trim()))},
  {title:'EDUCATION',lines:education.map(e=>[e.qualification,e.institution,e.year].filter(Boolean).join(' — ')).filter(Boolean)},
  {title:'PROJECTS',lines:[p.projects]},
  {title:'CERTIFICATIONS',lines:[p.certifications]}
 ].filter(section=>section.lines.some(line=>line.trim()));
}

export function refreshCvFromProfile(cv:CV,profile:Profile):CV{
 const experienceIds=cv.selectedExperienceIds??cv.profile.experiences.map(e=>e.id);
 const educationIds=cv.selectedEducationIds??cv.profile.education.map(e=>e.id);
 return{
  ...cv,
  profile:structuredClone(profile),
  selectedExperienceIds:experienceIds.filter(id=>profile.experiences.some(e=>e.id===id)),
  selectedEducationIds:educationIds.filter(id=>profile.education.some(e=>e.id===id)),
  updatedAt:new Date().toISOString()
 };
}
