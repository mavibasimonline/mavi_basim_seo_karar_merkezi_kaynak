import {build} from 'esbuild';
// Reuse the dashboard's already loaded UI/chart modules instead of shipping copies.
for(const [entry,outfile,prefix] of [['src/browser/unified-seo-panel.js','public/unified-seo.js','./'],['src/browser/insights-workspace.js','public/seo/workspace.js','../']])await build({
 entryPoints:[entry],bundle:true,minify:true,format:'esm',charset:'utf8',outfile,external:['./seo/workspace.js'],
 plugins:[{name:'shared-dashboard-modules',setup(builder){
  builder.onResolve({filter:/\/public\/(ui|chart)\.js$/},args=>({path:prefix+args.path.split('/').at(-1),external:true}));
 }}],
});
