import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import {VitePWA} from 'vite-plugin-pwa';

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
     globPatterns:['**/*.{js,mjs,css,html,svg,ico,png}'],
     globIgnores:['**/html2canvas.*.js','**/purify.es-*.js']
    }
   })
  ],
  test:{environment:'jsdom',setupFiles:['./src/test/setup.ts']}
 };
});
