import type {CV} from './types';

type Props={cv:CV;onChange:(patch:Partial<CV>)=>void};

export default function CVSelectionFields({cv,onChange}:Props){
 const availableSkills=[...new Set([...cv.profile.skills.split(/[,;\n]/).map(skill=>skill.trim()).filter(Boolean),...cv.selectedSkills])];
 const selectedExperiences=cv.selectedExperienceIds??cv.profile.experiences.map(e=>e.id);
 const selectedEducation=cv.selectedEducationIds??cv.profile.education.map(e=>e.id);
 return <div className="cv-selection">
  <fieldset>
   <legend>Skills to include</legend>
   {availableSkills.length?availableSkills.map(skill=><label className="cv-selection-option" key={skill}>
    <input type="checkbox" aria-label={`Include skill ${skill}`} checked={cv.selectedSkills.includes(skill)} onChange={event=>onChange({selectedSkills:event.target.checked?[...new Set([...cv.selectedSkills,skill])]:cv.selectedSkills.filter(item=>item!==skill)})}/>
    <span>{skill}</span>
   </label>):<p className="hint">Add skills in your Career Passport to select them here.</p>}
  </fieldset>
  <fieldset>
   <legend>Experience to include</legend>
   {cv.profile.experiences.length?cv.profile.experiences.map(experience=><label className="cv-selection-option" key={experience.id}>
    <input type="checkbox" aria-label={`Include experience ${experience.title||experience.organisation||'entry'}`} checked={selectedExperiences.includes(experience.id)} onChange={event=>onChange({selectedExperienceIds:event.target.checked?[...new Set([...selectedExperiences,experience.id])]:selectedExperiences.filter(id=>id!==experience.id)})}/>
    <span>{[experience.title,experience.organisation].filter(Boolean).join(' — ')||'Untitled experience'}</span>
   </label>):<p className="hint">No experience entries in this CV.</p>}
  </fieldset>
  <fieldset>
   <legend>Education to include</legend>
   {cv.profile.education.length?cv.profile.education.map(education=><label className="cv-selection-option" key={education.id}>
    <input type="checkbox" aria-label={`Include education ${education.qualification||education.institution||'entry'}`} checked={selectedEducation.includes(education.id)} onChange={event=>onChange({selectedEducationIds:event.target.checked?[...new Set([...selectedEducation,education.id])]:selectedEducation.filter(id=>id!==education.id)})}/>
    <span>{[education.qualification,education.institution].filter(Boolean).join(' — ')||'Untitled qualification'}</span>
   </label>):<p className="hint">No education entries in this CV.</p>}
  </fieldset>
 </div>;
}
