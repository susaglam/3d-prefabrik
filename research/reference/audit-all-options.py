import asyncio,json,pathlib
from playwright.async_api import async_playwright
out=pathlib.Path(__file__).resolve().parent;base='https://directsamenstellen.nl/28befe23-1200-4d1c-8092-e48a83477820'
async def run(browser,mode,width,height):
 page=await browser.new_page(viewport={'width':width,'height':height},ignore_https_errors=True)
 records=[];blocked=[]
 async def route(r):
  if r.request.method not in ['GET','HEAD','OPTIONS']:
   blocked.append({'method':r.request.method,'url':r.request.url});await r.abort()
  else: await r.continue_()
 await page.route('**/*',route)
 await page.goto(base,wait_until='domcontentloaded');await page.wait_for_timeout(3000)
 await page.screenshot(path=str(out/f'{mode}-initial.png'),full_page=True)
 await page.locator('input[type=number]').nth(0).fill('500');await page.locator('input[type=number]').nth(1).fill('300');await page.locator('#foot-button').click();await page.wait_for_timeout(800)
 for n in range(1,24):
  txt=await page.locator('body').inner_text();record={'index':n,'url':page.url,'text':txt,'viewport':await page.evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight})'),'options':[]};records.append(record)
  if 'Bevestig & vraag aan' in txt:
   await page.screenshot(path=str(out/f'{mode}-contact.png'),full_page=True)
   # Native blank-contact validation only: prevents any actual request and no data entered.
   await page.locator('#foot-button').click();await page.wait_for_timeout(200)
   record['emptyContactInvalid']=await page.locator('input').evaluate_all('(els)=>els.map(e=>({placeholder:e.placeholder,type:e.type,valid:e.validity.valid,message:e.validationMessage,required:e.required}))')
   record['storageKeys']=await page.evaluate('({local:Object.keys(localStorage),session:Object.keys(sessionStorage)})')
   break
  print(mode,n,page.url,flush=True)
  (out/f'{mode}-observations.json').write_text(json.dumps({'records':records,'blocked':blocked},indent=2,ensure_ascii=False))
  groups=page.locator('.radio-container:visible')
  if not await groups.count():record['error']='missing groups';break
  for idx in range(await groups.count()):
   group=groups.nth(idx);buttons=group.locator('button');texts=await buttons.all_inner_texts()
   if mode=='desktop-all':
    for j in range(await buttons.count()):
     await buttons.nth(j).click();await page.wait_for_timeout(140)
     record['options'].append({'text':texts[j],'selected':await buttons.nth(j).locator('.radio-mark').get_attribute('class'),'images':await page.locator('img.full-media-image').evaluate_all('(es)=>es.filter(e=>!e.classList.contains("hidden")).map(e=>({src:e.src,complete:e.complete,width:e.naturalWidth,height:e.naturalHeight}))')})
   choice=1 if mode=='mobile-skip' and 'Stel aanbouw binnenzijde samen' in txt else 0
   await buttons.nth(choice).click()
  if n in [1,3,5,10,12,15]:await page.screenshot(path=str(out/f'{mode}-step-{n:02}.png'),full_page=True)
  if mode=='desktop-all' and n==1:
   await page.locator('.previous-button').click();await page.wait_for_timeout(200)
   record['backRetainsDimensions']=await page.locator('input[type=number]').evaluate_all('(es)=>es.map(e=>e.value)')
   await page.locator('#foot-button').click();await page.wait_for_timeout(200)
   record['backRetainsFaçade']=await page.locator('.radio-mark').evaluate_all('(es)=>es.map(e=>e.className)')
  await page.locator('#foot-button').click();await page.wait_for_timeout(800)
 (out/f'{mode}-observations.json').write_text(json.dumps({'records':records,'blocked':blocked},indent=2,ensure_ascii=False))
 print(mode,'steps',len(records),'options visited',sum(len(r['options']) for r in records),'overflows',[(r['index'],r['viewport']) for r in records if r['viewport']['documentWidth']>width],'blocked',len(blocked))
 await page.close()
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/home/sukru/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  await asyncio.gather(run(browser,'desktop-all',1500,1000),run(browser,'mobile-skip',390,844))
  await browser.close()
asyncio.run(main())
