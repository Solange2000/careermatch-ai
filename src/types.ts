export type Experience={id:string;title:string;organisation:string;dates:string;details:string};
export type Education={id:string;qualification:string;institution:string;year:string};
export type Profile={id:string;name:string;email:string;phone:string;location:string;summary:string;skills:string;experiences:Experience[];education:Education[];projects:string;certifications:string};
export type CV={id:string;title:string;jobTitle:string;company:string;createdAt:string;updatedAt:string;profile:Profile;summary:string;selectedSkills:string[];selectedExperienceIds?:string[];selectedEducationIds?:string[];template:'classic'|'modern'|'graduate';jobDescription:string};
export type JobAdvertisement={id:string;title:string;company:string;location?:string;description:string;url:string;source:'url'|'description'|'pdf'|'docx'|'txt'|'image';status:'pending'|'ready'|'failed';updatedAt:string;error?:string};
export type Match={term:string;matched:boolean;source:string};
export const emptyProfile:Profile={id:'guest',name:'',email:'',phone:'',location:'',summary:'',skills:'',experiences:[],education:[],projects:'',certifications:''};
