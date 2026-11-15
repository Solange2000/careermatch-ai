import type {CV} from './types';

export const filename=(name:string)=>name.replace(/[^a-z0-9-_ ]/gi,'').trim().replace(/\s+/g,'_').slice(0,70)||'CareerMatch_CV';
export const pointsToMillimetres=(points:number)=>points*25.4/72;
export const themeFor=(cv:CV)=>({
 classic:{accent:'17365D',centerHeader:false},
 modern:{accent:'237C62',centerHeader:false},
 graduate:{accent:'17365D',centerHeader:true}
}[cv.template]);
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
