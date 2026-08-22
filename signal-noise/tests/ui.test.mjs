import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the page relative to THIS file so the suite runs from a fresh clone.
const PAGE = process.env.SIGNAL_NOISE_PAGE
  ? 'file://' + process.env.SIGNAL_NOISE_PAGE
  : 'file://' + join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'index.html');
// Honour a preinstalled browser if one is pinned, otherwise let Playwright
// use whatever `npx playwright install` put in place.
const LAUNCH = process.env.PLAYWRIGHT_CHROMIUM_PATH
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
  : {};
const NOW = Date.now();
const iso = h => new Date(NOW - h*3600e3).toISOString();
let fails=0, passes=0;
const check=(n,c,d)=>{ if(c){passes++;console.log('PASS  '+n)} else {fails++;console.log('FAIL  '+n+(d?'  → '+d:''))} };

const mk=(id,title,corr,verdict,sig,topic,ents,outlets,h,pts,vel)=>({
  cluster_id:'c'+id, title, url:'https://ex.com/'+id, outlet:outlets[0],
  sources:['techcrunch','hackernews'], outlets, corroboration:corr, variants:corr, verdict,
  signal:sig, hype:corr>2?0.5:3, points:pts, comments:Math.round(pts/3), velocity:vel,
  topic, entities:ents, item_count:corr, press_count:corr, primary_count:corr>2?1:0,
  first_seen:iso(h), published_at:iso(h), updated_at:new Date(NOW-60e3).toISOString()});

const stories=[
  mk(1,'OpenAI releases GPT-6 with native agent support',5,'CONFIRMED',92.4,'models',['openai'],['techcrunch.com','theverge.com','wired.com','reuters','arstechnica.com'],1.2,640,45),
  mk(2,'Anthropic says its models hacked 3 organizations during testing',3,'CONFIRMED',61.0,'safety',['anthropic'],['engadget.com','apnews.com','wired.com'],3,210,0),
  mk(3,'Gemini Robotics 2 brings whole body intelligence to robots',3,'CONFIRMED',48.2,'models',['google'],['deepmind.google','arstechnica.com','blog.google'],5,120,0),
  mk(4,'Nvidia earnings beat on AI datacenter demand',2,'DEVELOPING',33.1,'hardware',['nvidia'],['cnbc.com','reuters'],2,300,60),
  mk(5,'New jailbreak defeats frontier model guardrails',2,'DEVELOPING',28.0,'safety',['openai'],['zdnet.com','venturebeat.com'],4,90,0),
  mk(6,'Real IT Solutions Launches AI Advisory Practice for West Michigan',1,'WIRE',6.2,'other',[],['morningstar'],2,0,0),
  mk(7,'Show HN: fine-tune an 8B model on a laptop GPU',1,'SINGLE SOURCE',22.5,'opensource',[],['github.com'],1,140,0),
  mk(8,'EU opens consultation on AI Act enforcement',1,'SINGLE SOURCE',14.0,'policy',[],['euractiv.com'],8,20,0),
  ...Array.from({length:22},(_,i)=>mk(20+i,'Filler agent story about tooling #'+i,1,'SINGLE SOURCE',10-i*0.3,'agents',[],['x'+i+'.com'],6+i,10,0)),
];
const quotes=[{symbol:'NVDA',price:206.6,change_pct:2.93},{symbol:'MSFT',price:487.6,change_pct:4.93},
  {symbol:'GOOGL',price:373.5,change_pct:-1.2},{symbol:'META',price:590.2,change_pct:6.02}];
const topics=[{topic:'models',stories:14,prior_stories:6,signal:200,points:900,top_corroboration:5},
  {topic:'agents',stories:23,prior_stories:25,signal:120,points:300,top_corroboration:1},
  {topic:'safety',stories:9,prior_stories:3,signal:90,points:300,top_corroboration:3},
  {topic:'hardware',stories:6,prior_stories:7,signal:60,points:300,top_corroboration:2},
  {topic:'policy',stories:5,prior_stories:5,signal:30,points:20,top_corroboration:1},
  {topic:'opensource',stories:4,prior_stories:1,signal:40,points:140,top_corroboration:1}];
const labsD=[{lab:'openai',stories_24h:12,stories_7d:40,signal_24h:210,points_24h:900,top_corroboration:5},
  {lab:'anthropic',stories_24h:7,stories_7d:22,signal_24h:130,points_24h:400,top_corroboration:3},
  {lab:'google',stories_24h:6,stories_7d:20,signal_24h:110,points_24h:300,top_corroboration:3},
  {lab:'nvidia',stories_24h:4,stories_7d:11,signal_24h:70,points_24h:300,top_corroboration:2}];

const browser=await chromium.launch(LAUNCH);
async function open(vw){
  const p=await browser.newPage({viewport:vw});
  await p.route('**/rest/v1/signal_stories*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stories)}));
  await p.route('**/rest/v1/ai_quotes*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(quotes)}));
  await p.route('**/rest/v1/topic_map*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(topics)}));
  await p.route('**/rest/v1/lab_race*',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(labsD)}));
  await p.goto(PAGE);
  await p.waitForSelector('.row');
  return p;
}
const d=await open({width:1500,height:1000});
const errs=[]; d.on('pageerror',e=>errs.push(String(e)));

check('feed renders', (await d.$$('.row')).length>0);
check('top story is the 5-outlet CONFIRMED one',
  (await d.$eval('.row .ttl',e=>e.textContent)).includes('GPT-6'));
check('verdict badge shown', (await d.$eval('.row .vd',e=>e.textContent))==='CONFIRMED');
check('corroboration pips rendered', (await d.$$('.row .pips i')).length>0);
check('outlets listed on the row', (await d.$eval('.row .out',e=>e.textContent)).includes('techcrunch.com'));

// THE MAP
const tiles=await d.$$eval('.tile',els=>els.map(e=>({t:e.dataset.topic,w:parseFloat(e.style.width),h:parseFloat(e.style.height),bg:e.style.background||e.style.backgroundColor})));
check('treemap renders one tile per topic', tiles.length===6, JSON.stringify(tiles.map(t=>t.t)));
check('treemap tiles have positive area', tiles.every(t=>t.w>0&&t.h>0));
const agents=tiles.find(t=>t.t==='agents'), policy=tiles.find(t=>t.t==='policy');
check('bigger topic gets bigger tile', agents.w*agents.h > policy.w*policy.h,
  `agents=${Math.round(agents.w*agents.h)} policy=${Math.round(policy.w*policy.h)}`);
const safety=tiles.find(t=>t.t==='safety'), hardware=tiles.find(t=>t.t==='hardware');
const green=s=>{const m=s.match(/rgb\((\d+), (\d+), (\d+)\)/);return m?+m[2]-+m[1]:0};
check('heating topic greener than cooling topic', green(safety.bg) > green(hardware.bg),
  `safety=${safety.bg} hardware=${hardware.bg}`);

// map click filters feed
await d.click('.tile[data-topic="safety"]'); await d.waitForTimeout(250);
const safetyTitles=await d.$$eval('.row .ttl',els=>els.map(e=>e.textContent));
check('clicking a tile filters the feed to that topic',
  safetyTitles.length===2 && safetyTitles.every(t=>/hacked|jailbreak/i.test(t)), JSON.stringify(safetyTitles));
await d.keyboard.press('Escape'); await d.waitForTimeout(200);

// command bar
await d.click('#cmd'); await d.fill('#cmd','CONFIRMED'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
const cf=await d.$$eval('.row .vd',els=>els.map(e=>e.textContent));
check('CONFIRMED command shows only corroboration>=3', cf.length===3 && cf.every(v=>v==='CONFIRMED'), JSON.stringify(cf));
await d.fill('#cmd','LAB ANTHROPIC'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
check('LAB filter narrows to that lab', (await d.$$('.row')).length===1);
// CLEAR drops every filter and hands the window back to AUTO; widen explicitly
// afterwards so this assertion tests filter-clearing, not window width.
await d.fill('#cmd','CLEAR'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
await d.fill('#cmd','24H'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
check('CLEAR restores full list', (await d.$$('.row')).length>10, String((await d.$$('.row')).length));
const expected1H = stories.filter(s=>NOW-Date.parse(s.published_at) < 3600e3).length;
await d.fill('#cmd','1H'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
check('window command narrows by time', (await d.$$('.row')).length===expected1H,
  `got ${(await d.$$('.row')).length}, fixture has ${expected1H} within 1h`);
await d.fill('#cmd','24H'); await d.keyboard.press('Enter'); await d.waitForTimeout(200);
await d.fill('#cmd','nvidia'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
check('bare text searches titles', (await d.$eval('.row .ttl',e=>e.textContent)).toLowerCase().includes('nvidia'));
check('search term highlighted', (await d.$$('.row .ttl mark')).length>0);
await d.fill('#cmd','CLEAR'); await d.keyboard.press('Enter'); await d.waitForTimeout(200);

// HUD + panes
const hud=await d.textContent('#hud');
check('HUD reports confirmed count', /CONFIRMED\s*3/.test(hud.replace(/\s+/g,' ')), hud.replace(/\s+/g,' ').slice(0,120));
check('lab race lists labs', (await d.$$('#labs .lrow')).length===4);
check('lab race marks confirmed labs', (await d.textContent('#labs')).includes('✓'));
check('hype index computed', /\d\.\d\d/.test(await d.textContent('#hypeval')));
check('watchlist rendered', (await d.$$('#watch .lrow')).length>=5);
check('ticker shows quotes + confirmed stories',
  (await d.textContent('#tape-in')).includes('NVDA') && (await d.textContent('#tape-in')).includes('✓'));

// ---- auto window ----
// AUTO must land on the tightest window that has BOTH enough stories and at
// least one corroborated one — a fresh window full of SINGLE SOURCE items is
// exactly what the board should not open on.
await d.fill('#cmd','CLEAR'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
const hudAuto = (await d.textContent('#hud')).replace(/\s+/g,' ');
const inWin = (k)=>({'5M':5*60e3,'15M':15*60e3,'1H':3600e3,'6H':6*3600e3,'24H':86400e3}[k]);
const expectedAuto = ['5M','15M','1H','6H','24H'].find(k=>{
  const inw = stories.filter(x=>NOW-Date.parse(x.published_at)<inWin(k));
  return inw.length>=5 && inw.some(x=>(x.corroboration||1)>=2);
}) || '24H';
check('AUTO picks the tightest window with >=5 stories AND corroboration',
  hudAuto.includes('WINDOW ' + expectedAuto) && hudAuto.includes('AUTO'),
  `expected ${expectedAuto}, hud says: ${hudAuto.slice(0,80)}`);
check('AUTO window is not empty', (await d.$$('.row')).length >= 5);
check('AUTO never opens on a wall of SINGLE SOURCE',
  (await d.$$eval('.row .vd', els => els.map(e=>e.textContent))).some(v => v !== 'SINGLE SOURCE'));
// an explicit window choice must turn AUTO off and stick
await d.fill('#cmd','7D'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
const hudManual = (await d.textContent('#hud')).replace(/\s+/g,' ');
check('explicit window overrides AUTO', hudManual.includes('WINDOW 7D') && !hudManual.includes('AUTO'), hudManual.slice(0,80));
await d.fill('#cmd','AUTO'); await d.keyboard.press('Enter'); await d.waitForTimeout(250);
check('AUTO command re-enables auto selection',
  (await d.textContent('#hud')).includes('AUTO'));
await d.fill('#cmd','CLEAR'); await d.keyboard.press('Enter'); await d.waitForTimeout(200);
await d.press('#cmd','Escape');

// keyboard nav — shortcuts must yield to the command input while it has focus
await d.fill('#cmd','j');
check('letters typed into the command bar do not trigger shortcuts',
  (await d.$$('.row.sel')).length===0);
await d.press('#cmd','Escape');
await d.keyboard.press('j'); await d.keyboard.press('j');
check('j/k selects rows', (await d.$eval('.row.sel .rk',e=>e.textContent))==='2');

// ---- downstream hand-off ----------------------------------------------
// PARTNER is null in the open-source build and set on the hosted one, so the
// suite asserts whichever contract applies to the file under test.
const partner = await d.evaluate(() => (typeof PARTNER === 'undefined' ? null : PARTNER));
if(!partner){
  check('open-source build ships no partner CTA', (await d.$$('.pack')).length===0);
} else {
  // Stub the partner host: this suite must not depend on someone else's site
  // being reachable, and CI has no egress.
  const phost = new URL(partner.url).host;
  await d.context().route(u => u.host === phost,
    r => r.fulfill({status:200, contentType:'text/html', body:'<html><body>partner</body></html>'}));
  check('hand-off chip renders on every row', (await d.$$('.pack')).length===(await d.$$('.row')).length);
  const before = d.url();
  const [popup] = await Promise.all([
    d.waitForEvent('popup', {timeout:5000}),
    d.click('.row .pack'),
  ]);
  check('hand-off opens the partner, tagged so it is measurable',
    popup.url().startsWith(partner.url) && popup.url().includes('utm_source=signalnoise'), popup.url());
  await popup.close();
  check('chip click does NOT follow the row through to the article', d.url()===before, d.url());
  check('hand-off confirms in the HUD', (await d.textContent('#hud')).toLowerCase().includes(partner.name.toLowerCase()));
  // keyboard parity: the terminal is keyboard-first, the chip must be too
  await d.keyboard.press('Escape');
  await d.keyboard.press('j');
  const [popup2] = await Promise.all([
    d.waitForEvent('popup', {timeout:5000}),
    d.keyboard.press('p'),
  ]);
  check('p hands off the selected row', popup2.url().includes('utm_medium=story-handoff'), popup2.url());
  await popup2.close();
  await d.fill('#cmd','CLEAR'); await d.keyboard.press('Enter'); await d.press('#cmd','Escape');
}

check('no JS errors', errs.length===0, errs.join(' | '));

const m=await open({width:390,height:844});
check('mobile renders feed', (await m.$$('.row')).length>0);
check('mobile renders map', (await m.$$('.tile')).length===6);
await browser.close();
console.log('\n'+passes+' passed, '+fails+' failed');
if(fails) process.exit(1);
