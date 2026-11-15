import {jsPDF} from 'jspdf';
import type {CV} from './types';
import {sections} from './cv-content';
import {filename,pointsToMillimetres,themeFor} from './export-shared';

export function createPdfDocument(cv:CV){
 const pdf=new jsPDF({unit:'mm',format:'a4'});
 const margin=19;
 const width=172;
 const bottomMargin=19;
 const theme=themeFor(cv);
 let y=22;
 const lineHeight=(size:number)=>pointsToMillimetres(size)*1.25;
 function wrappedLines(text:string,size:number,bold:boolean){
  pdf.setFont('helvetica',bold?'bold':'normal');
  pdf.setFontSize(size);
  return pdf.splitTextToSize(text||' ',width) as string[];
 }
 function ensureSpace(height:number){
  if(y+height>pdf.internal.pageSize.getHeight()-bottomMargin){
   pdf.addPage();
   y=22;
  }
 }
 function drawLines(wrapped:string[],size:number,bold:boolean,center:boolean,color:string){
  pdf.setFont('helvetica',bold?'bold':'normal');
  pdf.setFontSize(size);
  pdf.setTextColor(`#${color}`);
  const step=lineHeight(size);
  for(const line of wrapped){
   ensureSpace(step);
   pdf.text(line,center?105:margin,y,{align:center?'center':'left'});
   y+=step;
  }
 }
 function paragraph(text:string,size:number,bold:boolean,center:boolean,color:string){
  drawLines(wrappedLines(text,size,bold),size,bold,center,color);
  y+=2;
 }
 paragraph(cv.profile.name||'Your Name',19,true,theme.centerHeader,theme.accent);
 paragraph([cv.profile.email,cv.profile.phone,cv.profile.location].filter(Boolean).join(' | '),9,false,theme.centerHeader,'687A8D');
 y+=4;
 for(const section of sections(cv)){
  const body=section.lines.filter(line=>line.trim());
  const titleLines=wrappedLines(section.title,11,true);
  const firstBodyLine=wrappedLines(body[0],10,false)[0];
  const headingHeight=titleLines.length*lineHeight(11);
  const ruleOffset=pointsToMillimetres(11)*1.05;
  const bodyOffset=pointsToMillimetres(10)*1.2;
  ensureSpace(headingHeight+ruleOffset+bodyOffset+lineHeight(10));
  drawLines(titleLines,11,true,false,theme.accent);
  const ruleY=y+ruleOffset;
  pdf.setDrawColor(`#${theme.accent}`);
  pdf.setLineWidth(.3);
  pdf.line(margin,ruleY,margin+width,ruleY);
  y=ruleY+bodyOffset;
  drawLines([firstBodyLine],10,false,false,'263B52');
  for(let index=0;index<body.length;index++){
   const wrapped=wrappedLines(body[index],10,false);
   drawLines(wrapped.slice(index===0?1:0),10,false,false,'263B52');
   y+=2;
  }
  y+=3;
 }
 return pdf;
}

export function exportPdf(cv:CV){
 createPdfDocument(cv).save(`${filename(cv.title)}.pdf`);
}
