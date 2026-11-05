import {build} from 'esbuild';
// Reuse the dashboard's already loaded UI/chart modules instead of shipping copies.
await build({
 entryPoints:['src/browser/unified-seo-panel.js'],bundle:true,minify:true,format:'esm',charset:'utf8',outfile:'public/unified-seo.js',
 plugins:[{name:'shared-dashboard-modules',setup(builder){
  builder.onResolve({filter:/\/public\/(ui|chart)\.js$/},args=>({path:'./'+args.path.split('/').at(-1),external:true}));
 }}],
});
