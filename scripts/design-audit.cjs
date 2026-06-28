#!/usr/bin/env node
/* Design/JS/CSS consolidation audit across /srv apps.
   Heuristic (regex) inventory — not a full AST parse, but accurate enough
   for a consolidation pass. Scans .js/.ejs/.html/.css, including inline
   <style> and <script> blocks in templates. */
const fs = require('fs');
const path = require('path');

const APPS = ['graffiti-tv','greealitytv','games','servers','slab','opsTrain'];
const ROOT = '/srv';
const SKIP = new Set(['node_modules','.git','_archive','depricated','.cache','dist','build','vendor']);

function walk(dir, out=[]) {
  let ents;
  try { ents = fs.readdirSync(dir,{withFileTypes:true}); } catch { return out; }
  for (const e of ents) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir,e.name);
    if (e.isDirectory()) walk(p,out);
    else if (/\.(js|cjs|mjs|ejs|html|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

// extractors
const reFuncDecl = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
const reArrow    = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
const reArrow1   = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?[A-Za-z_$][\w$]*\s*=>/g;
const reGetId    = /getElementById\(\s*['"`]([^'"`]+)['"`]/g;
const reQuery    = /querySelector(?:All)?\(\s*['"`]([^'"`]+)['"`]/g;
const reClassList= /classList\.(?:add|remove|toggle|contains|replace)\(\s*['"`]([^'"`]+)['"`]/g;
const reGetClass = /getElementsByClassName\(\s*['"`]([^'"`]+)['"`]/g;
const reStyle    = /<style[^>]*>([\s\S]*?)<\/style>/gi;
const reScript   = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const reCssVarDef= /(--[A-Za-z0-9-]+)\s*:/g;
const reCssVarUse= /var\(\s*(--[A-Za-z0-9-]+)/g;
const reCssClass = /\.([A-Za-z_][\w-]*)\b(?=[^{}]*\{)/g; // class in a selector preceding a block
const reCssId    = /#([A-Za-z_][\w-]*)\b(?=[^{}]*\{)/g;
const reMarkupCls= /class\s*=\s*["']([^"']+)["']/g;
const reHexColor = /#[0-9a-fA-F]{3,8}\b/g;

function add(map,k,n=1){ map[k]=(map[k]||0)+n; }

const report = { generatedAt:new Date().toISOString(), apps:{}, global:{
  tokensDefined:{}, tokensUsed:{}, jsSelectors:{}, hexColors:{}, totals:{}
}};

for (const app of APPS) {
  const base = path.join(ROOT, app);
  if (!fs.existsSync(base)) continue;
  const files = walk(base);
  const A = {
    fileCounts:{js:0,ejs:0,html:0,css:0},
    functions:0, functionNames:{},
    jsIdRefs:{}, jsClassRefs:{}, jsQueryRefs:{},
    cssClassDefs:{}, cssIdDefs:{},
    tokensDefined:{}, tokensUsed:{},
    markupClasses:{}, hexColors:{}, inlineStyleBlocks:0, inlineScriptBlocks:0,
    fileCount: files.length
  };

  for (const f of files) {
    let src; try { src = fs.readFileSync(f,'utf8'); } catch { continue; }
    const ext = path.extname(f).slice(1);
    if (ext==='ejs') A.fileCounts.ejs++;
    else if (ext==='html') A.fileCounts.html++;
    else if (ext==='css') A.fileCounts.css++;
    else A.fileCounts.js++;

    // gather JS source: raw if js, else inline <script> blocks
    let jsChunks = [];
    let cssChunks = [];
    if (ext==='js'||ext==='cjs'||ext==='mjs') jsChunks.push(src);
    else if (ext==='css') cssChunks.push(src);
    else { // ejs/html
      let m;
      while((m=reScript.exec(src))){ jsChunks.push(m[1]); A.inlineScriptBlocks++; }
      reScript.lastIndex=0;
      while((m=reStyle.exec(src))){ cssChunks.push(m[1]); A.inlineStyleBlocks++; }
      reStyle.lastIndex=0;
      let mm; while((mm=reMarkupCls.exec(src))){ mm[1].split(/\s+/).forEach(c=>{ if(c&&!c.includes('<%')) add(A.markupClasses,c); }); }
    }

    for (const js of jsChunks) {
      let m;
      while((m=reFuncDecl.exec(js))){ A.functions++; add(A.functionNames,m[1]); }
      while((m=reArrow.exec(js))){ A.functions++; add(A.functionNames,m[1]); }
      while((m=reArrow1.exec(js))){ A.functions++; add(A.functionNames,m[1]); }
      while((m=reGetId.exec(js))){ add(A.jsIdRefs,m[1]); }
      while((m=reClassList.exec(js))){ add(A.jsClassRefs,m[1]); }
      while((m=reGetClass.exec(js))){ add(A.jsClassRefs,m[1]); }
      while((m=reQuery.exec(js))){ add(A.jsQueryRefs,m[1]); }
    }
    for (const css of cssChunks) {
      let m;
      while((m=reCssVarDef.exec(css))){ add(A.tokensDefined,m[1]); }
      while((m=reCssVarUse.exec(css))){ add(A.tokensUsed,m[1]); }
      while((m=reCssClass.exec(css))){ add(A.cssClassDefs,m[1]); }
      while((m=reCssId.exec(css))){ add(A.cssIdDefs,m[1]); }
      while((m=reHexColor.exec(css))){ add(A.hexColors,m[0].toLowerCase()); }
    }
  }

  // merge to global
  for (const [k,v] of Object.entries(A.tokensDefined)) add(report.global.tokensDefined,k,v);
  for (const [k,v] of Object.entries(A.tokensUsed)) add(report.global.tokensUsed,k,v);
  for (const [k,v] of Object.entries(A.jsClassRefs)) add(report.global.jsSelectors,'.'+k,v);
  for (const [k,v] of Object.entries(A.jsIdRefs)) add(report.global.jsSelectors,'#'+k,v);
  for (const [k,v] of Object.entries(A.hexColors)) add(report.global.hexColors,k,v);

  A.uniqueFunctions = Object.keys(A.functionNames).length;
  A.uniqueTokensDefined = Object.keys(A.tokensDefined).length;
  A.uniqueTokensUsed = Object.keys(A.tokensUsed).length;
  A.uniqueHexColors = Object.keys(A.hexColors).length;
  report.apps[app] = A;
}

// global totals
report.global.totals = {
  apps: Object.keys(report.apps).length,
  totalFunctions: Object.values(report.apps).reduce((s,a)=>s+a.functions,0),
  uniqueTokensDefined: Object.keys(report.global.tokensDefined).length,
  uniqueTokensUsed: Object.keys(report.global.tokensUsed).length,
  uniqueHexColors: Object.keys(report.global.hexColors).length
};

fs.writeFileSync('/srv/scripts/design-audit.json', JSON.stringify(report,null,2));

// console summary
const top = (o,n=12)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,n);
console.log('=== PER-APP ===');
for (const [app,A] of Object.entries(report.apps)) {
  console.log(`\n## ${app}  (files: ${A.fileCount} | ejs:${A.fileCounts.ejs} js:${A.fileCounts.js} css:${A.fileCounts.css} html:${A.fileCounts.html})`);
  console.log(`   functions: ${A.functions} (${A.uniqueFunctions} unique) | inline <style>:${A.inlineStyleBlocks} <script>:${A.inlineScriptBlocks}`);
  console.log(`   tokens defined: ${A.uniqueTokensDefined} | tokens used: ${A.uniqueTokensUsed} | distinct hex colors: ${A.uniqueHexColors}`);
}
console.log('\n=== GLOBAL TOKENS DEFINED (top) ===');
top(report.global.tokensDefined,20).forEach(([k,v])=>console.log(`   ${k}: ${v}`));
console.log('\n=== GLOBAL DISTINCT HEX COLORS ===', report.global.totals.uniqueHexColors);
top(report.global.hexColors,15).forEach(([k,v])=>console.log(`   ${k}: ${v}`));
console.log('\n=== TOTALS ===', JSON.stringify(report.global.totals));
console.log('\nFull JSON -> /srv/scripts/design-audit.json');
