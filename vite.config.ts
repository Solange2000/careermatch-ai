import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {defineConfig} from 'vitest/config';
import type {Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';

const require=createRequire(import.meta.url);
function packageRoot(name:string){return dirname(require.resolve(`${name}/package.json`))}
function localOcrAssets(){
 const tesseractRoot=packageRoot('tesseract.js');
 const coreRoot=packageRoot('tesseract.js-core');
 const languageRoot=packageRoot('@tesseract.js-data/eng');
 return new Map([
  ['worker.min.js',resolve(tesseractRoot,'dist','worker.min.js')],
  ['tesseract-core-lstm.wasm.js',resolve(coreRoot,'tesseract-core-lstm.wasm.js')],
  ['tesseract-core-lstm.wasm',resolve(coreRoot,'tesseract-core-lstm.wasm')],
  ['eng.traineddata.gz',resolve(languageRoot,'4.0.0_best_int','eng.traineddata.gz')]
 ]);
}
function localOcrAssetsPlugin():Plugin{
 const assets=localOcrAssets();
 return{
  name:'local-tesseract-ocr-assets',
  configureServer(server){
   server.middlewares.use('/ocr',(request,response,next)=>{
    const fileName=new URL(request.url||'/', 'http://localhost').pathname.replace(/^\/+/,'');
    const asset=assets.get(fileName);
    if(!asset||!['GET','HEAD'].includes(request.method||'')){next();return}
    const content=readFileSync(asset);
    response.setHeader('Content-Type',fileName.endsWith('.wasm')?'application/wasm':fileName.endsWith('.gz')?'application/gzip':'text/javascript');
    response.setHeader('Content-Length',content.byteLength);
    response.setHeader('Cache-Control','no-store');
    response.end(request.method==='HEAD'?undefined:content);
   });
  },
  generateBundle(){
   for(const [fileName,sourcePath] of assets)this.emitFile({type:'asset',fileName:`ocr/${fileName}`,source:readFileSync(sourcePath)});
  }
 };
}

export default defineConfig(({mode})=>{
 if(mode==='production'){
  const endpoint=process.env.VITE_JOB_EXTRACTION_ENDPOINT?.trim();
  if(endpoint){
   let parsed:URL;
   try{parsed=new URL(endpoint)}catch{throw new Error('Production VITE_JOB_EXTRACTION_ENDPOINT must be a valid HTTPS URL.')}
   if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Production VITE_JOB_EXTRACTION_ENDPOINT must be HTTPS and contain no credentials, query, or fragment.')
   process.env.VITE_JOB_EXTRACTION_ENDPOINT=endpoint;
  }else process.env.VITE_JOB_EXTRACTION_ENDPOINT='';
 }
 return {
  plugins:[
   react(),
   localOcrAssetsPlugin(),
   VitePWA({
    registerType:'autoUpdate',
    includeAssets:['icon.svg'],
    manifest:{
     name:'CareerMatch AI',
     short_name:'CareerMatch',
     description:'Free offline-first CV tailoring',
     theme_color:'#17365d',
     background_color:'#f5f7fa',
     display:'standalone',
     start_url:'/',
     icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'}]
    },
    workbox:{
     navigateFallback:'/index.html',
     globPatterns:['**/*.{js,mjs,css,html,svg,ico,png,wasm,gz}'],
     maximumFileSizeToCacheInBytes:6*1024*1024,
     globIgnores:['**/html2canvas.*.js','**/purify.es-*.js']
    }
   })
  ],
  test:{environment:'jsdom',setupFiles:['./src/test/setup.ts']}
 };
});
