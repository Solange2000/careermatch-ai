import {AlignmentType,BorderStyle,Document,HeadingLevel,Packer,Paragraph,TextRun} from 'docx';
import type {CV} from './types';
import {sections} from './cv-content';
import {download,filename,themeFor} from './export-shared';

export function createDocxDocument(cv:CV){
 const profile=cv.profile;
 const theme=themeFor(cv);
 const alignment=theme.centerHeader?AlignmentType.CENTER:AlignmentType.LEFT;
 const children=[
  new Paragraph({children:[new TextRun({text:profile.name||'Your Name',bold:true,size:40,color:theme.accent})],alignment,spacing:{after:140}}),
  new Paragraph({children:[new TextRun({text:[profile.email,profile.phone,profile.location].filter(Boolean).join(' | '),size:18,color:'687A8D'})],alignment,spacing:{after:260}})
 ];
 for(const section of sections(cv)){
  const body=section.lines.filter(line=>line.trim());
  children.push(new Paragraph({children:[new TextRun({text:section.title,bold:true,size:22,color:theme.accent})],heading:HeadingLevel.HEADING_2,keepNext:true,spacing:{before:260,after:80}}));
  children.push(new Paragraph({
   children:[new TextRun({text:' ',size:2})],
   keepNext:true,
   border:{top:{color:theme.accent,space:2,size:4,style:BorderStyle.SINGLE}},
   spacing:{before:80,after:120}
  }));
  for(const line of body){
   children.push(new Paragraph({text:line,spacing:{after:120}}));
  }
 }
 return new Document({sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1080,right:1080,bottom:1080,left:1080}}},children}]});
}

export async function exportDocx(cv:CV){
 const blob=await Packer.toBlob(createDocxDocument(cv));
 download(blob,`${filename(cv.title)}.docx`);
}
