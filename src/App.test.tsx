import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import App from './App';
import {db} from './db';
import {emptyProfile,type Profile} from './types';

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

beforeEach(async()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});await db.delete();await db.open()});
afterEach(async()=>{vi.restoreAllMocks();Object.defineProperty(navigator,'onLine',{configurable:true,value:true});await db.delete()});

describe('CareerMatch workflows',()=>{
 it('adds and autosaves profile experience so it is restored after remount',async()=>{
  const user=userEvent.setup();
  const app=render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Career Passport'}));
  await user.click(screen.getByRole('button',{name:/Add experience/i}));
  await user.type(screen.getByLabelText('Role / title'),'Support analyst');
  await user.type(screen.getByLabelText('Organisation'),'Example Ltd');
  await user.type(screen.getByLabelText('Dates'),'2024–2025');
  await user.type(screen.getByLabelText('Responsibilities and achievements'),'Resolved customer reports.');
  await waitFor(async()=>{
   const saved=await db.profiles.get('guest');
   expect(saved?.experiences).toContainEqual(expect.objectContaining({title:'Support analyst',organisation:'Example Ltd',dates:'2024–2025',details:'Resolved customer reports.'}));
  });
  expect((await screen.findByRole('status')).textContent).toContain('Changes saved successfully!');
  app.unmount();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Career Passport'}));
  expect(await screen.findByDisplayValue('Support analyst')).toBeTruthy();
 });

 it('supports evidence selection and refreshes profile data without losing CV edits',async()=>{
  await db.profiles.put(profile);
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Quick Tailor'}));
  await user.type(screen.getByLabelText('Target job title'),'Analyst');
  await user.type(screen.getByLabelText('Employer (optional)'),'Example Co');
  await user.type(screen.getByLabelText('Job advertisement'),'Excel and SQL reporting');
  await user.click(screen.getByRole('button',{name:/Analyse job/i}));
  await user.click(screen.getByRole('button',{name:/Create tailored CV/i}));
  await screen.findByLabelText('CV name');

  await user.click(screen.getByRole('checkbox',{name:'Include skill SQL'}));
  await user.click(screen.getByRole('checkbox',{name:'Include experience Volunteer'}));
  await user.click(screen.getByRole('checkbox',{name:'Include education Certificate'}));
  await user.click(screen.getByRole('button',{name:'Save changes'}));
  await waitFor(async()=>expect((await db.cvs.toArray())[0].selectedSkills).toEqual(['Excel']));

  await user.click(screen.getByRole('button',{name:'Career Passport'}));
  await user.clear(screen.getByLabelText('City / Province'));
  await user.type(screen.getByLabelText('City / Province'),'Cape Town');
  await waitFor(async()=>expect((await db.profiles.get('guest'))?.location).toBe('Cape Town'));

  await user.click(screen.getByRole('button',{name:'My CVs'}));
  await user.click(await screen.findByRole('button',{name:'Edit'}));
  await user.clear(screen.getByLabelText('CV name'));
  await user.type(screen.getByLabelText('CV name'),'My edited CV');
  await user.clear(screen.getByLabelText('Professional summary'));
  await user.type(screen.getByLabelText('Professional summary'),'My own verified summary.');
  await user.click(screen.getByRole('button',{name:'Refresh from Career Passport'}));

  await waitFor(async()=>{
   const saved=(await db.cvs.toArray())[0];
   expect(saved).toMatchObject({title:'My edited CV',summary:'My own verified summary.'});
   expect(saved.profile.location).toBe('Cape Town');
   expect(saved.selectedSkills).toEqual(['Excel']);
   expect(saved.selectedExperienceIds).toEqual(['exp-1']);
   expect(saved.selectedEducationIds).toEqual(['edu-1']);
  });
 });

 it('announces an invalid restore instead of changing stored data',async()=>{
  await db.profiles.put({...emptyProfile,name:'Existing'});
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Settings'}));
  const upload=screen.getByLabelText(/Restore backup/i);
  fireEvent.change(upload,{target:{files:[new File(['{}'],'bad.json',{type:'application/json'})]}});
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid or unreadable backup file.');
  expect((await db.profiles.get('guest'))?.name).toBe('Existing');
 });

 it('rejects malformed saved CV records before replacing local data',async()=>{
  await db.profiles.put({...emptyProfile,name:'Existing'});
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Settings'}));
  const backup={format:'careermatch-backup-v1',profile:{...profile,name:'Invalid restore'},cvs:[{id:'broken-cv'}],jobs:[]};
  fireEvent.change(screen.getByLabelText(/Restore backup/i),{target:{files:[new File([JSON.stringify(backup)],'bad-record.json',{type:'application/json'})]}});
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid or unreadable backup file.');
  expect((await db.profiles.get('guest'))?.name).toBe('Existing');
  expect(await db.cvs.toArray()).toEqual([]);
 });

 it('exposes the mobile navigation toggle state to assistive technology',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  const toggle=await screen.findByRole('button',{name:'Toggle navigation'});
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.getAttribute('aria-controls')).toBe('primary-navigation');
  await user.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  const dashboard=screen.getByRole('button',{name:'Dashboard'});
  expect(document.activeElement).toBe(dashboard);
  await user.keyboard('{Escape}');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
 });

 it('disables CV save controls during an IndexedDB write and reports failures',async()=>{
  const savedCv={
   id:'cv-locked',title:'Original CV',jobTitle:'Analyst',company:'Example Co',
   createdAt:'2026-01-01',updatedAt:'2026-01-01',profile,summary:'Verified summary.',
   selectedSkills:['Excel'],selectedExperienceIds:['exp-1'],selectedEducationIds:['edu-1'],
   template:'classic' as const,jobDescription:'Excel reports'
  };
  await db.cvs.put(savedCv);
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'My CVs'}));
  await user.click(await screen.findByRole('button',{name:'Edit'}));

  let releaseWrite!:()=>void;
  const pendingWrite=new Dexie.Promise<string>(resolve=>{releaseWrite=()=>resolve(savedCv.id)});
  const put=vi.spyOn(db.cvs,'put').mockImplementation(()=>pendingWrite);
  const saveButton=screen.getByRole<HTMLButtonElement>('button',{name:'Save changes'});
  await user.click(saveButton);
  expect(saveButton.disabled).toBe(true);
  expect((await screen.findByRole('status')).textContent).toContain('Saving CV...');
  await user.click(saveButton);
  expect(put).toHaveBeenCalledTimes(1);
  releaseWrite();
  await waitFor(()=>expect(saveButton.disabled).toBe(false));

  put.mockRejectedValueOnce(new Error('Storage quota exceeded'));
  await user.click(saveButton);
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to save CV.');
 });

 it('reports delete and restore storage failures without hiding them',async()=>{
  await db.profiles.put({...emptyProfile,name:'Existing'});
  const savedCv={
   id:'cv-delete',title:'Delete me',jobTitle:'Analyst',company:'',
   createdAt:'2026-01-01',updatedAt:'2026-01-01',profile,summary:'Verified summary.',
   selectedSkills:['Excel'],template:'classic' as const,jobDescription:''
  };
  await db.cvs.put(savedCv);
  vi.spyOn(window,'confirm').mockReturnValue(true);
  vi.spyOn(db.cvs,'delete').mockRejectedValue(new Error('Storage unavailable'));
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'My CVs'}));
  await user.click(screen.getByRole('button',{name:'Delete Delete me'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to delete CV.');
  expect(await db.cvs.get(savedCv.id)).toBeTruthy();

  vi.restoreAllMocks();
  vi.spyOn(window,'confirm').mockReturnValue(true);
  vi.spyOn(db.profiles,'put').mockRejectedValue(new Error('Storage unavailable'));
  await user.click(screen.getByRole('button',{name:'Settings'}));
  const backup={format:'careermatch-backup-v1',profile:{...profile,name:'Restored'},cvs:[]};
  fireEvent.change(screen.getByLabelText(/Restore backup/i),{target:{files:[new File([JSON.stringify(backup)],'backup.json',{type:'application/json'})]}});
  expect((await screen.findByRole('alert')).textContent).toContain('Unable to restore backup.');
  expect((await db.profiles.get('guest'))?.name).toBe('Existing');
 });

 it('deletes profile and CV data without autosaving an empty profile back',async()=>{
  await db.profiles.put({...profile,id:'guest'});
  await db.cvs.put({id:'cv-delete-all',title:'Saved CV',jobTitle:'Analyst',company:'',createdAt:'2026-01-01',updatedAt:'2026-01-01',profile,summary:'Verified.',selectedSkills:[],template:'classic',jobDescription:''});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Settings'}));
  await user.click(screen.getByRole('button',{name:/Delete local data/i}));
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Local data deleted successfully!'));
  expect(await db.profiles.get('guest')).toBeUndefined();
  expect(await db.cvs.toArray()).toEqual([]);
 });

 it('restores a valid backup transactionally and reports success',async()=>{
  await db.profiles.put({...profile,id:'guest',name:'Old profile'});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Settings'}));
  const backup={format:'careermatch-backup-v1',profile:{...profile,name:'Restored profile'},cvs:[]};
  fireEvent.change(screen.getByLabelText(/Restore backup/i),{target:{files:[new File([JSON.stringify(backup)],'backup.json',{type:'application/json'})]}});
  await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('Backup restored successfully!'));
  expect((await db.profiles.get('guest'))?.name).toBe('Restored profile');
 });

 it('saves a job URL offline without claiming its contents were retrieved',async()=>{
  Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Quick Tailor'}));
  await user.click(screen.getByRole('button',{name:'Paste Job Link'}));
  await user.type(screen.getByLabelText('Job advertisement URL'),'https://jobs.example/analyst');
  await user.click(screen.getByRole('button',{name:/Save link locally/i}));
  await waitFor(async()=>{
   expect(await db.jobs.toArray()).toEqual([expect.objectContaining({url:'https://jobs.example/analyst',description:'',status:'pending',source:'url'})]);
  });
  expect((await screen.findByRole('status')).textContent).toContain('cannot be retrieved until you are online');
  expect((screen.getByRole('button',{name:'Retrieve details'}) as HTMLButtonElement).disabled).toBe(true);
 });

 it('loads, edits, and persists saved job location for offline review',async()=>{
  await db.jobs.put({
   id:'job-maziv',title:'IT Administrator',company:'MAZIV',location:'Durban North, KwaZulu-Natal',
   description:'Excel reporting and SQL administration',url:'https://jobs.example/it-admin',
   source:'url',status:'ready',updatedAt:'2026-01-01'
  });
  const user=userEvent.setup();
  const app=render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Quick Tailor'}));
  await user.selectOptions(screen.getByLabelText('Saved job advertisements'),'job-maziv');
  expect((screen.getByLabelText('Target job title') as HTMLInputElement).value).toBe('IT Administrator');
  expect((screen.getByLabelText('Employer (optional)') as HTMLInputElement).value).toBe('MAZIV');
  expect((screen.getByLabelText('Job location (optional)') as HTMLInputElement).value).toBe('Durban North, KwaZulu-Natal');
  await user.clear(screen.getByLabelText('Job location (optional)'));
  await user.type(screen.getByLabelText('Job location (optional)'),'Cape Town');
  await user.click(screen.getByRole('button',{name:'Save job locally'}));
  await waitFor(async()=>expect((await db.jobs.get('job-maziv'))?.location).toBe('Cape Town'));

  app.unmount();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Quick Tailor'}));
  await user.selectOptions(screen.getByLabelText('Saved job advertisements'),'job-maziv');
  expect((screen.getByLabelText('Job location (optional)') as HTMLInputElement).value).toBe('Cape Town');
 });

 it('imports and saves a TXT job advertisement locally',async()=>{
  const user=userEvent.setup();
  render(<App/>);
  await user.click(await screen.findByRole('button',{name:'Quick Tailor'}));
  await user.click(screen.getByRole('button',{name:'Upload Job Advertisement'}));
  await user.upload(screen.getByLabelText('Job advertisement file'),new File(['Excel reporting and SQL analysis'],'analyst.txt',{type:'text/plain'}));
  await waitFor(async()=>{
   expect(await db.jobs.toArray()).toEqual([expect.objectContaining({source:'txt',status:'ready',description:'Excel reporting and SQL analysis'})]);
  });
  expect((await screen.findByRole('status')).textContent).toContain('imported and saved locally');
  expect((screen.getByLabelText('Imported job description') as HTMLTextAreaElement).value).toBe('Excel reporting and SQL analysis');
 });
});
