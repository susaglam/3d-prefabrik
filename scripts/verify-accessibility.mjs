import AxeBuilder from '@axe-core/playwright';
import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'docs/verification/accessibility-results.json');
const base=process.env.PREFAB_TEST_URL||'http://127.0.0.1:8078';
const url=new URL(base);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Accessibility runner is restricted to a local development server.');
const results={startedAt:new Date().toISOString(),url:`${base}/prefab`,tags:['wcag2a','wcag2aa','wcag21aa'],
    scope:'Automated axe-core plus explicit SVG text contrast checks; no customer submission or external network access.',scans:[],explicitContrast:[],pageErrors:[],externalRequests:[]};
try{
    const previous=JSON.parse(await readFile(output,'utf8'));
    if(previous.baseline)results.baseline=previous.baseline;
    else if(previous.finishedAt&&previous.summary?.violationCount)results.baseline={
        startedAt:previous.startedAt,finishedAt:previous.finishedAt,summary:previous.summary};
}catch{/* A first run has no earlier evidence. */}
let browser;

async function scan(page,name){
    const audit=await new AxeBuilder({page}).withTags(results.tags).analyze();
    const simplify=violation=>({id:violation.id,impact:violation.impact,description:violation.description,
        help:violation.help,helpUrl:violation.helpUrl,tags:violation.tags,nodes:violation.nodes.map(node=>({
            target:node.target,html:node.html,failureSummary:node.failureSummary,
            checks:[...node.any,...node.all,...node.none].map(check=>({id:check.id,message:check.message,data:check.data}))}))});
    results.scans.push({name,viewport:page.viewportSize(),violations:audit.violations.map(simplify),
        incomplete:audit.incomplete.map(simplify),passes:audit.passes.map(check=>check.id)});
    console.log(`${name}: ${audit.violations.length} rule violations, ${audit.violations.reduce((n,v)=>n+v.nodes.length,0)} failing nodes`);
    await persist();
}

async function checkSvgContrast(page){
    const colours=await page.locator('.prefab-plan svg').evaluate(svg=>{
        const background=svg.querySelector('rect').getAttribute('fill');
        const floor=svg.querySelector('rect[fill="#e5e0d3"]').getAttribute('fill');
        return [...svg.querySelectorAll('text')].map(text=>({
            text:text.textContent,foreground:getComputedStyle(text).fill,
            background:text.textContent.includes('m²')?floor:background,
        }));
    });
    const luminance=colour=>{
        const channels=colour.startsWith('#')?colour.slice(1).match(/../g).map(x=>parseInt(x,16)):
            colour.match(/[\d.]+/g).slice(0,3).map(Number);
        const linear=channels.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
        return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];
    };
    results.explicitContrast=colours.map(item=>{
        const f=luminance(item.foreground),b=luminance(item.background),ratio=(Math.max(f,b)+.05)/(Math.min(f,b)+.05);
        return {...item,contrastRatio:Number(ratio.toFixed(3)),required:4.5,passed:ratio>=4.5,
            method:'Computed SVG text fill against its explicit scene background rectangle; WCAG relative luminance.'};
    });
    console.log(`SVG text contrast: ${results.explicitContrast.filter(item=>item.passed).length}/${colours.length} pass`);
}

async function persist(){
    const byRule={};
    for(const scan of results.scans)for(const violation of scan.violations){
        const rule=byRule[violation.id]||={impact:violation.impact,scans:[],nodeCount:0,examples:[]};
        rule.scans.push(scan.name);rule.nodeCount+=violation.nodes.length;
        for(const node of violation.nodes){
            const contrast=node.checks.find(check=>check.id==='color-contrast')?.data;
            const key=JSON.stringify([node.target,contrast?.fgColor,contrast?.bgColor]);
            if(!rule.examples.some(item=>item.key===key))rule.examples.push({key,selector:node.target,
                contrast:contrast||null,failure:node.failureSummary,html:node.html});
        }
    }
    results.summary={scanCount:results.scans.length,violationCount:results.scans.reduce((sum,scan)=>sum+scan.violations.length,0),
        explicitContrastCount:results.explicitContrast.length,explicitContrastFailures:results.explicitContrast.filter(item=>!item.passed).length,byRule};
    await mkdir(join(root,'docs/verification'),{recursive:true});
    await writeFile(output,JSON.stringify(results,null,2)+'\n');
}

try{
    const executable=process.env.CHROMIUM_PATH||[
        join(homedir(),'.cache/ms-playwright/chromium-1234/chrome-linux64/chrome'),
        join(homedir(),'.cache/ms-playwright/chromium-1217/chrome-linux64/chrome'),
    ].find(existsSync);
    const env={...process.env},lib='/tmp/cs-psk-browser-libs/extracted/usr/lib/x86_64-linux-gnu';
    if(existsSync(lib))env.LD_LIBRARY_PATH=[env.LD_LIBRARY_PATH,lib].filter(Boolean).join(':');
    browser=await chromium.launch({headless:true,executablePath:executable,env,args:['--no-sandbox','--enable-unsafe-swiftshader']});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.route('**/*',async route=>{
        const requestUrl=new URL(route.request().url());
        if(['data:','blob:'].includes(requestUrl.protocol)||requestUrl.origin===url.origin)await route.continue();
        else {results.externalRequests.push(requestUrl.origin+requestUrl.pathname);await route.abort();}
    });
    const page=await context.newPage();page.on('pageerror',error=>results.pageErrors.push(error.message));
    await page.goto(`${base}/prefab`);await page.waitForSelector('#preview-scene canvas');
    await expect(page.locator('.price-value')).not.toHaveClass(/pending/);
    const step=async number=>{await page.locator(`.step-tab[data-step="${number}"]`).click();await expect(page.locator('#step-title')).toBeVisible();};
    for(let number=0;number<7;number++){
        await step(number);await scan(page,`desktop-step-${number+1}`);
        if(number===4){await page.locator('input[name="interior"][value="true"]').locator('..').click();await scan(page,'desktop-interior-options');}
    }
    await page.locator('[data-action="contact"]').click();await expect(page.locator('#quote-form')).toBeVisible();
    await scan(page,'desktop-contact-modal');
    await page.locator('#quote-form button[type="submit"]').click();
    await expect(page.locator('#contact-firstName')).toHaveAttribute('aria-invalid','true');
    await scan(page,'desktop-contact-validation');
    await page.keyboard.press('Escape');
    await page.locator('[data-mode="2d"]').click();await step(0);await scan(page,'desktop-2d-plan');await checkSvgContrast(page);
    await page.setViewportSize({width:390,height:844});await scan(page,'mobile390-initial');
    await step(2);await scan(page,'mobile390-opening-options');
    await step(4);await scan(page,'mobile390-interior-options');
    await step(6);await page.locator('[data-action="contact"]').click();await scan(page,'mobile390-contact-modal');
    results.finishedAt=new Date().toISOString();await persist();
    console.log(JSON.stringify({scans:results.summary.scanCount,violations:results.summary.violationCount,
        explicitContrastChecks:results.summary.explicitContrastCount,explicitContrastFailures:results.summary.explicitContrastFailures,
        rules:Object.keys(results.summary.byRule),pageErrors:results.pageErrors.length,externalRequests:results.externalRequests.length,report:output}));
    process.exitCode=results.summary.violationCount||results.summary.explicitContrastFailures||results.pageErrors.length?1:0;
}catch(error){results.error=error.stack||String(error);await persist();console.error(error);process.exitCode=1;}
finally{await browser?.close();}
