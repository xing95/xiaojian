const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/xing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),file=path.join(root,'dist/styles.css');
  const source=fs.readFileSync(path.join(root,'dist/app.js'),'utf8')+fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
  const before=fs.statSync(file).size;
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.goto(pathToFileURL(path.join(root,'dist/index.html')).href);
    const css=await page.evaluate(({source,css})=>{
      function clean(rules){return Array.from(rules).map(rule=>{
        if(rule.type===CSSRule.STYLE_RULE){
          const selectors=rule.selectorText.split(',').filter(selector=>Array.from(selector.matchAll(/[.#]([\w-]+)/g)).every(m=>source.includes(m[1])));
          if(!selectors.length)return '';return selectors.join(', ')+ ' { '+rule.style.cssText+' }';
        }
        if(rule.cssRules&&rule.type===CSSRule.MEDIA_RULE){const inner=clean(rule.cssRules);return inner.trim()?`@media ${rule.conditionText} {\n${inner}\n}`:'';}
        return rule.cssText;
      }).filter(Boolean).join('\n');}
      const sheet=new CSSStyleSheet();sheet.replaceSync(css);return clean(sheet.cssRules);
    },{source,css:fs.readFileSync(file,'utf8')});
    fs.writeFileSync(file,css+'\n');console.log(`Styles: ${before} -> ${fs.statSync(file).size} bytes; removed unused selectors.`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
