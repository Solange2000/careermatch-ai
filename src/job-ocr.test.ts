import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const {createWorkerMock}=vi.hoisted(()=>({createWorkerMock:vi.fn()}));
vi.mock('tesseract.js',()=>({createWorker:createWorkerMock}));
import {createWorker} from 'tesseract.js';
import {extractJobOcrFields,extractJobTextFromImage,isJobImageFile} from './job-ocr';

const worker={recognize:vi.fn(),terminate:vi.fn()};
const offlineFetch=vi.fn();
let imageDimensions={width:800,height:600};

beforeEach(()=>{
 vi.clearAllMocks();
 Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
 imageDimensions={width:800,height:600};
 worker.recognize.mockResolvedValue({data:{text:'Job Title: IT Administrator\nRequired Skills\n- SQL and Excel',confidence:90}});
 worker.terminate.mockResolvedValue(undefined);
 createWorkerMock.mockResolvedValue(worker);
 class FakeImage{
  get naturalWidth(){return imageDimensions.width}
  get naturalHeight(){return imageDimensions.height}
  onload:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  set src(_value:string){this.onload?.()}
 }
 const OriginalURL=URL;
 const TestURL=Object.assign(class extends OriginalURL{},{
  createObjectURL:vi.fn(()=> 'blob:local-image'),
  revokeObjectURL:vi.fn()
 });
 vi.stubGlobal('URL',TestURL);
 vi.stubGlobal('Image',FakeImage);
 vi.stubGlobal('fetch',offlineFetch);
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({
  drawImage:vi.fn(),translate:vi.fn(),rotate:vi.fn()
 } as unknown as CanvasRenderingContext2D));
});

afterEach(()=>{
 vi.restoreAllMocks();
 vi.unstubAllGlobals();
 Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
});

describe('job screenshot OCR helpers',()=>{
 it('accepts supported image extensions and MIME types only',()=>{
  for(const name of ['job.png','job.jpg','job.jpeg','job.webp']){
   expect(isJobImageFile(new File(['image'],name,{type:'application/octet-stream'}))).toBe(true);
  }
  expect(isJobImageFile(new File(['image'],'job',{type:'image/webp'}))).toBe(true);
  expect(isJobImageFile(new File(['text'],'job.txt',{type:'text/plain'}))).toBe(false);
 });

 it('extracts only text explicitly present in OCR-labelled fields and sections',()=>{
  const fields=extractJobOcrFields(`IT Administrator
Job Title: IT Administrator
Employer: MAZIV
Location: Durban North, KwaZulu-Natal
Responsibilities
- Support business systems
Qualifications
- Diploma in Information Technology
Experience
- Two years in systems support
Required Skills
- SQL and Microsoft Excel`);
  expect(fields).toEqual({
   title:'IT Administrator',
   company:'MAZIV',
   location:'Durban North, KwaZulu-Natal',
   sections:{
    responsibilities:'- Support business systems',
    qualifications:'- Diploma in Information Technology',
    experience:'- Two years in systems support',
    requiredSkills:'- SQL and Microsoft Excel'
   }
  });
 });

 it('does not fill missing job details with guesses',()=>{
  expect(extractJobOcrFields('Apply now\nResponsibilities\n- Keep records')).toEqual({
   title:'',
   company:'',
   location:'',
   sections:{responsibilities:'- Keep records'}
  });
 });

 it('keeps an unlabeled requirements section separate from recognized skills',()=>{
  expect(extractJobOcrFields('Requirements\n- Travel between sites').sections).toEqual({
   requirements:'- Travel between sites'
  });
 });

 it('runs OCR with same-origin assets and works without network access',async()=>{
  Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
  const file=new File(['local image bytes'],'job.webp',{type:'image/webp'});
  const progress=vi.fn();
  await expect(extractJobTextFromImage(file,progress)).resolves.toEqual({
   text:'Job Title: IT Administrator\nRequired Skills\n- SQL and Excel',
   confidence:90,
   quality:'good'
  });
  expect(createWorker).toHaveBeenCalledWith('eng',1,expect.objectContaining({
   workerPath:'/ocr/worker.min.js',
   corePath:'/ocr/tesseract-core-lstm.wasm.js',
   langPath:'/ocr',
   cacheMethod:'write',
   workerBlobURL:false,
   gzip:true
  }));
  expect(worker.recognize).toHaveBeenCalledTimes(1);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(offlineFetch).not.toHaveBeenCalled();
 });

 it('explains how to recover when local OCR assets are not cached',async()=>{
  createWorkerMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(extractJobTextFromImage(new File(['image'],'job.png',{type:'image/png'}))).rejects.toThrow('Open the app online once so its worker and language model can be cached');
 });

 it('retries rotated images and returns text from the strongest OCR result',async()=>{
  worker.recognize
   .mockResolvedValueOnce({data:{text:'',confidence:0}})
   .mockResolvedValueOnce({data:{text:'sideways noise',confidence:20}})
   .mockResolvedValueOnce({data:{text:'IT Administrator\nQualifications\nDiploma in IT',confidence:85}})
   .mockResolvedValueOnce({data:{text:'short noise',confidence:15}});
  const result=await extractJobTextFromImage(new File(['image'],'job.jpg',{type:'image/jpeg'}));
  expect(result).toEqual({text:'IT Administrator\nQualifications\nDiploma in IT',confidence:85,quality:'low'});
  expect(worker.recognize).toHaveBeenCalledTimes(4);
 });

 it('rejects unsupported, empty, oversized and unreadable images clearly',async()=>{
  await expect(extractJobTextFromImage(new File(['data'],'job.txt',{type:'text/plain'}))).rejects.toThrow('Choose a PNG, JPG, JPEG or WebP');
  await expect(extractJobTextFromImage(new File([],'empty.png',{type:'image/png'}))).rejects.toThrow('image is empty');
  await expect(extractJobTextFromImage(new File([new Uint8Array(10*1024*1024+1)],'large.png',{type:'image/png'}))).rejects.toThrow('10 MB or smaller');
  worker.recognize.mockResolvedValue({data:{text:'',confidence:0}});
  await expect(extractJobTextFromImage(new File(['image'],'blank.png',{type:'image/png'}))).rejects.toThrow('No readable text was found');
  expect(worker.terminate).toHaveBeenCalledOnce();
 });

 it('rejects extreme pixel dimensions before starting OCR',async()=>{
  imageDimensions={width:10_000,height:5_000};
  await expect(extractJobTextFromImage(new File(['image'],'huge.jpg',{type:'image/jpeg'}))).rejects.toThrow('40 megapixels');
  expect(createWorker).not.toHaveBeenCalled();
 });
});
