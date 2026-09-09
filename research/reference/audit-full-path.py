import asyncio,json,pathlib
from playwright.async_api import async_playwright
out=pathlib.Path(__file__).resolve().parent;base='https://directsamenstellen.nl/28befe23-1200-4d1c-8092-e48a83477820'
async def main():
 async with async_playwright() as p:
  b=await p.chromium.launch(executable_path='/home/sukru/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',headless=True,args=['--no-sandbox'])
  page=await b.new_page(viewport={'width':1500,'height':1000},ignore_https_errors=True)
  blocked=[];snapshots=[]
  async def route(r):
   if r.request.method not in ['GET','HEAD','OPTIONS']:
    blocked.append({'method':r.request.method,'url':r.request.url});await r.abort()
   else:await r.continue_()
  await page.route('**/*',route)
  await page.goto(base,wait_until='domcontentloaded');await page.wait_for_timeout(3500)
  # Empty and out of range validation.
  await page.locator('#foot-button').click();await page.wait_for_timeout(300)
  print('EMPTY',(await page.locator('body').inner_text())[:1000])
  await page.locator('input[type=number]').nth(0).fill('100');await page.locator('input[type=number]').nth(1).fill('500');await page.locator('#foot-button').click();await page.wait_for_timeout(300)
  print('INVALID',(await page.locator('body').inner_text())[:1000])
  await page.locator('input[type=number]').nth(0).fill('500');await page.locator('input[type=number]').nth(1).fill('300');await page.locator('#foot-button').click();await page.wait_for_timeout(500)
  for n in range(1,24):
   txt=await page.locator('body').inner_text(); data={'index':n,'url':page.url,'text':txt,'inputs':await page.locator('input').evaluate_all('(els)=>els.map(el=>({type:el.type,name:el.name,value:el.value,checked:el.checked,placeholder:el.placeholder,required:el.required}))')};snapshots.append(data)
   print('STEP',n,page.url,txt[:500].replace('\n',' | '))
   await page.screenshot(path=str(out/f'walk-{n:02}.png'),full_page=True)
   if 'Bevestig & vraag aan' in txt:
    (out/'contact-dom.html').write_text(await page.content());break
   if n==1:(out/'radio-dom.html').write_text(await page.content())
   groups=page.locator('.radio-container')
   if await groups.count():
    for idx in range(await groups.count()):
     await groups.nth(idx).locator('button').first.click()
   else:
    print('NO GROUPS',await page.locator('button').all_inner_texts());(out/'no-radio-dom.html').write_text(await page.content());break
   await page.locator('#foot-button').click();await page.wait_for_timeout(650)
  (out/'walkthrough.json').write_text(json.dumps(snapshots,indent=2,ensure_ascii=False));(out/'walkthrough-blocked.json').write_text(json.dumps(blocked,indent=2))
  await b.close()
asyncio.run(main())
