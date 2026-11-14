import {jsPDF} from 'jspdf';
import type {CV} from './types';
import {sections} from './cv-content';
import {filename,themeFor} from './export-shared';

export function exportPdf(cv:CV){
 const document=new jsPDF({unit:'mm',format:'a4'});
 const margin=19;
 const width=172;
 const bottomMargin=19;
 const theme=themeFor(cv);
 let y=22;
 function ensureSpace(height:number){
  if(y+height>document.internal.pageSize.getHeight()-bottomMargin){
   document.addPage();
   y=22;
  }
 }
 function lines(text:string,size=10,bold=false,center=false,color=theme.accent){
  document.setFont('helvetica',bold?'bold':'normal');
  document.setFontSize(size);
  document.setTextColor(`#${color}`);
  const wrapped=document.splitTextToSize(text||' ',width) as string[];
  const lineHeight=size*.48;
  for(const line of wrapped){
   ensureSpace(lineHeight);
   document.text(line,center?105:margin,y,{align:center?'center':'left'});
   y+=lineHeight;
  }
  y+=2;
 }
 lines(cv.profile.name||'Your Name',19,true,theme.centerHeader);
 lines([cv.profile.email,cv.profile.phone,cv.profile.location].filter(Boolean).join(' | '),9,false,theme.centerHeader,'687A8D');
 y+=4;
 for(const section of sections(cv)){
  ensureSpace(18);
  lines(section.title,11,true,false,theme.accent);
  document.setDrawColor(`#${theme.accent}`);
  document.setLineWidth(.3);
  document.line(margin,y-1,margin+width,y-1);
  for(const line of section.lines)if(line.trim())lines(line,10,false,false,'263B52');
  y+=2;
 }
 document.save(`${filename(cv.title)}.pdf`);
}
