/** Aurora Orbit: deterministic, DOM-free tower defense simulation.
 * Public actions mutate their game and return a success boolean (step returns game).
 * dt is seconds; internally fixed 60 Hz. Paused/non-running calls change nothing.
 */
export const WIDTH = 480;
export const HEIGHT = 700;
export const BASE_Y = 618;
export const STEP = 1 / 60;
export const TOTAL_WAVES = 12;

const freeze = Object.freeze;
export const UPGRADES = freeze({
  damage: freeze({id:'damage', name:'Solar prism', title:'Solar prism', description:'+24% laser damage. Stacks multiplicatively.', icon:'✦', color:'#ffcd72', maxStacks:5}),
  rate: freeze({id:'rate', name:'Rapid oscillator', title:'Rapid oscillator', description:'+20% firing speed for every turret.', icon:'»', color:'#80e9ff', maxStacks:5}),
  chain: freeze({id:'chain', name:'Arc conductor', title:'Arc conductor', description:'Lasers chain to another nearby enemy at 60% power.', icon:'ϟ', color:'#8ba8ff', maxStacks:3}),
  pierce: freeze({id:'pierce', name:'Phase lens', title:'Phase lens', description:'Lasers pierce one additional enemy at 70% power.', icon:'◇', color:'#d2a0ff', maxStacks:3}),
  frost: freeze({id:'frost', name:'Cryo beam', title:'Cryo beam', description:'Laser hits slow enemies. More stacks deepen the chill.', icon:'❄', color:'#9affed', maxStacks:3}),
  turret: freeze({id:'turret', name:'Satellite cannon', title:'Satellite cannon', description:'Deploy an extra turret with full upgrade benefits.', icon:'⊕', color:'#ffe8aa', maxStacks:3}),
  repair: freeze({id:'repair', name:'Hull renewal', title:'Hull renewal', description:'Restore 40 hull, gain 12 maximum hull and refill shields.', icon:'+', color:'#a9ffb7', maxStacks:5}),
  shield: freeze({id:'shield', name:'Aegis lattice', title:'Aegis lattice', description:'+25 shield capacity and stronger shield regeneration.', icon:'⬡', color:'#73d9ff', maxStacks:4}),
  reactor: freeze({id:'reactor', name:'Flux reactor', title:'Flux reactor', description:'+30% energy regeneration and +15 maximum energy.', icon:'◎', color:'#ffb3e3', maxStacks:3}),
  critical: freeze({id:'critical', name:'Targeting core', title:'Targeting core', description:'+15% critical chance. Critical laser hits deal double damage.', icon:'⌖', color:'#ff9c9c', maxStacks:3})
});

const clamp = (x,lo,hi) => Math.max(lo,Math.min(hi,x));
const distance2 = (a,b) => (a.x-b.x)**2+(a.y-b.y)**2;
const living = e => e.hp > 0 && !e.escaped;
function random(g) {
  g.rng = (g.rng + 0x6D2B79F5) >>> 0;
  let n = g.rng;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
function emit(g,type,data={}) {
  g.events.push({id:g.eventId++, type, time:g.time, ...data});
  if(g.events.length>100) g.events.shift();
}
function stats(g) {
  const u=g.upgrades;
  return {
    damage: 12 * 1.24**u.damage,
    rate: 1.20**u.rate,
    interval: .56 / 1.20**u.rate,
    chain:u.chain,
    pierce:u.pierce,
    frost:u.frost,
    critical:u.critical*.15,
    turretCount:3+u.turret,
    energyRegen:1.45*(1+u.reactor*.30),
    shieldRegen:1.5+u.shield*.65
  };
}
function rebuildTurrets(g) {
  const n=g.stats.turretCount;
  g.turrets=Array.from({length:n},(_,i)=>({id:i, x:72+i*(336/(n-1)), y:650-Math.sin(i/(n-1)*Math.PI)*15, angle:-Math.PI/2, cooldown:i*.075, recoil:0, targetId:null}));
}
export function createGame(seed=1) {
  const normalized=Number.isFinite(Number(seed)) ? Number(seed)>>>0 : 1;
  const g={
    version:1,seed:normalized,rng:normalized,state:'title',wave:1,totalWaves:TOTAL_WAVES,
    width:WIDTH,height:HEIGHT,baseY:BASE_Y,time:0,waveTime:0,ticks:0,accumulator:0,
    hp:100,maxHp:100,shield:45,maxShield:45,energy:70,maxEnergy:100,score:0,
    kills:0,breaches:0,combo:0,bestCombo:0,comboTimer:0,
    overdrive:0,pulseFlash:0,pulseCooldown:0,overdriveCooldown:0,screenShake:0,lastDamage:-100,
    waveKills:0,waveBreaches:0,waveTotal:0,spawned:0,
    enemies:[],beams:[],effects:[],events:[],turrets:[],choices:[],
    nextId:1,eventId:1,upgrades:Object.fromEntries(Object.keys(UPGRADES).map(id=>[id,0])),
    stats:null,aim:{x:240,y:250,active:false},lastWaveBonus:0,result:null
  };
  g.stats=stats(g);rebuildTurrets(g);
  return g;
}
function makeEnemy(g,type,x,y,extra={}) {
  const w=g.wave;
  const hpTable={scout:24+w*4.3,armor:58+w*8.0,splitter:38+w*6,boss:260+w*49};
  const hp=hpTable[type];
  const enemy={
    id:g.nextId++,type,x,y,spawnX:x,spawnY:y,hp,maxHp:hp,
    radius:type==='boss'?25:type==='armor'?13:type==='splitter'?12:9,
    speed:(14+w*1.8)*(type==='armor'?.8:type==='boss'?.68:type==='splitter'?1.08:1),
    damage:type==='boss'?42:type==='armor'?13:type==='splitter'?10:7,
    value:type==='boss'?450:type==='armor'?60:type==='splitter'?45:25,
    phase:random(g)*Math.PI*2,slow:0,flash:0,age:0,escaped:false,split:false,
    ...extra
  };
  enemy.x=clamp(enemy.x,enemy.radius+12,WIDTH-enemy.radius-12);
  enemy.spawnX=enemy.x;
  g.spawned++;return enemy;
}
function populate(g) {
  // Nested semicircles form a readable, original descending orbital fleet.
  const w=g.wave;
  const rings=3+Math.floor((w-1)/4);
  const perRing=7+Math.floor((w-1)*.55);
  for(let ring=0;ring<rings;ring++) {
    const count=perRing+ring*2;
    const r=70+ring*49;
    for(let i=0;i<count;i++) {
      const theta=.13*Math.PI+i/(count-1)*.74*Math.PI;
      const x=240+Math.cos(theta)*r;
      const y=22+Math.sin(theta)*r*.88 + ring*12;
      const roll=random(g);
      const type=w>=3 && roll<.19?'splitter':w>=2&&roll<.44?'armor':'scout';
      g.enemies.push(makeEnemy(g,type,x,y,{ring,theta}));
    }
  }
  if(w%4===0) {
    g.enemies.push(makeEnemy(g,'boss',240,22,{phase:0}));
    if(w===12) {
      g.enemies.push(makeEnemy(g,'armor',196,2));
      g.enemies.push(makeEnemy(g,'armor',284,2));
    }
  }
  g.waveTotal=g.enemies.length;
}
export function startWave(g) {
  if(!g || !['title','upgrade'].includes(g.state)) return false;
  if(g.state==='upgrade') {
    if(g.wave>=TOTAL_WAVES) return false;
    g.wave++;
  }
  g.state='running';g.waveTime=0;g.accumulator=0;g.choices=[];
  g.enemies=[];g.beams=[];g.effects=[];g.waveKills=0;g.waveBreaches=0;g.spawned=0;
  g.overdrive=0;g.pulseFlash=0;g.combo=0;g.comboTimer=0;
  g.stats=stats(g);rebuildTurrets(g);populate(g);
  emit(g,'wave-start',{wave:g.wave});
  return true;
}
function rollChoices(g) {
  const available=Object.keys(UPGRADES).filter(id=>g.upgrades[id]<UPGRADES[id].maxStacks);
  const chosen=[];
  // Offer at least one core weapon choice, so RNG cannot strand a campaign.
  const weapons=available.filter(id=>['damage','rate','chain','pierce','turret','critical'].includes(id));
  if(weapons.length) chosen.push(weapons[Math.floor(random(g)*weapons.length)]);
  while(chosen.length<3 && chosen.length<available.length) {
    const pool=available.filter(id=>!chosen.includes(id));
    chosen.push(pool[Math.floor(random(g)*pool.length)]);
  }
  return chosen;
}
export function chooseUpgrade(g,id) {
  if(!g || g.state!=='upgrade' || !g.choices.includes(id) || !UPGRADES[id]) return false;
  if(g.upgrades[id]>=UPGRADES[id].maxStacks) return false;
  g.upgrades[id]++;
  if(id==='repair') {g.maxHp+=12;g.hp=Math.min(g.maxHp,g.hp+40);g.shield=g.maxShield;}
  if(id==='shield') {g.maxShield+=25;g.shield=g.maxShield;}
  if(id==='reactor') {g.maxEnergy+=15;g.energy=Math.min(g.maxEnergy,g.energy+30);}
  g.stats=stats(g);
  emit(g,'upgrade',{upgrade:id,level:g.upgrades[id]});
  return startWave(g);
}
function beam(g,a,b,color='#c9f989',width=2) {
  g.beams.push({x1:a.x,y1:a.y,x2:b.x,y2:b.y,life:.105,maxLife:.105,color,width});
}
function hurt(g,e,amount,source='laser') {
  if(!living(e)) return;
  // Armored hulls resist standard hits, but pulse and piercing beams bypass it.
  const resistance=e.type==='armor'&&source!=='pulse'&&source!=='pierce'?.83:1;
  e.hp-=amount*resistance;e.flash=.10;
  if(g.stats.frost && source!=='pulse') e.slow=Math.max(e.slow,1.2+g.stats.frost*.25);
  if(e.hp<=0) kill(g,e,source);
}
function kill(g,e,source) {
  e.hp=0;g.kills++;g.waveKills++;g.combo++;g.comboTimer=2.25;
  g.bestCombo=Math.max(g.bestCombo,g.combo);
  const earned=Math.round(e.value*(1+Math.min(g.combo,20)*.025));
  g.score+=earned;
  g.energy=Math.min(g.maxEnergy,g.energy+(e.type==='boss'?10:1.1));
  g.effects.push({type:'burst',x:e.x,y:e.y,color:e.type==='boss'?'#ffb76e':e.type==='armor'?'#d8a3ff':e.type==='splitter'?'#ff9ecf':'#6bf9e0',life:.4,maxLife:.4,radius:e.radius,seed:e.id});
  emit(g,'kill',{enemyId:e.id,enemyType:e.type,x:e.x,y:e.y,score:earned,source});
  if(e.type==='boss') {g.screenShake=.6;emit(g,'boss-down',{wave:g.wave});}
  if(e.type==='splitter'&&!e.split&&source!=='pulse') {
    for(const sign of [-1,1]) {
      const fragment=makeEnemy(g,'scout',clamp(e.x+sign*15,18,462),e.y+7,{hp:e.maxHp*.25,maxHp:e.maxHp*.25,radius:6,speed:e.speed*1.35,damage:4,value:12,split:true,phase:e.phase+sign});
      g.enemies.push(fragment);
    }
  }
}
function breach(g,e) {
  e.escaped=true;g.breaches++;g.waveBreaches++;g.combo=0;g.comboTimer=0;
  const absorbed=Math.min(g.shield,e.damage);
  g.shield-=absorbed;g.hp=Math.max(0,g.hp-(e.damage-absorbed));
  g.lastDamage=g.time;g.screenShake=.38;
  g.effects.push({type:'impact',x:e.x,y:BASE_Y,color:'#ff7b9e',life:.4,maxLife:.4,radius:e.radius});
  emit(g,'breach',{enemyId:e.id,damage:e.damage,absorbed,x:e.x,y:BASE_Y});
  if(g.hp<=0) {
    g.state='defeat';g.result={wave:g.wave,score:g.score,kills:g.kills,breaches:g.breaches,time:g.time};
    emit(g,'defeat',{wave:g.wave});
  }
}
function targetFor(g,turret,input) {
  let target=null,best=-Infinity;
  const aimActive=Number.isFinite(input.aimX)&&Number.isFinite(input.aimY);
  const ax=clamp(input.aimX??240,0,480),ay=clamp(input.aimY??250,0,618);
  for(const e of g.enemies) {
    if(!living(e)) continue;
    const proximity=aimActive?Math.hypot(e.x-ax,e.y-ay):Infinity;
    // Danger-aware auto aim remains helpful; dragging snaps to a local priority.
    const priority=e.y+(proximity<90?450-proximity*3:0)+(e.type==='boss'?12:0)-Math.abs(e.x-turret.x)*.045;
    if(priority>best) {best=priority;target=e;}
  }
  return target;
}
function fire(g,t,enemy,input) {
  const focused=Number.isFinite(input.aimX)&&Number.isFinite(input.aimY)&&Math.hypot(enemy.x-input.aimX,enemy.y-input.aimY)<90;
  const critical=random(g)<g.stats.critical;
  const damage=g.stats.damage*(focused?1.3:1)*(g.overdrive>0?1.3:1)*(critical?2:1);
  const color=critical?'#ffe6a1':g.overdrive>0?'#ffb4e9':g.stats.frost?'#a5ffe7':'#c9f989';
  beam(g,t,enemy,color,critical?3.3:g.overdrive>0?2.8:1.8);
  t.angle=Math.atan2(enemy.y-t.y,enemy.x-t.x);t.recoil=1;t.targetId=enemy.id;
  const visited=new Set([enemy.id]);
  // Capture ray before killing the first target, whose split can append enemies.
  const ex=enemy.x,ey=enemy.y;
  hurt(g,enemy,damage);
  let previous={x:ex,y:ey};
  for(let hop=0;hop<g.stats.chain;hop++) {
    let nearest=null,dist=125**2;
    for(const e of g.enemies) if(living(e)&&!visited.has(e.id)) {
      const d=distance2(previous,e);if(d<dist){dist=d;nearest=e;}
    }
    if(!nearest)break;
    visited.add(nearest.id);beam(g,previous,nearest,'#84e4ed',1.7);
    hurt(g,nearest,damage*.6**(hop+1),'chain');previous={x:nearest.x,y:nearest.y};
  }
  if(g.stats.pierce) {
    const dx=ex-t.x,dy=ey-t.y,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
    const candidates=g.enemies.filter(e=>living(e)&&!visited.has(e.id)).map(e=>({e,along:(e.x-t.x)*ux+(e.y-t.y)*uy,cross:Math.abs((e.x-t.x)*uy-(e.y-t.y)*ux)})).filter(p=>p.along>len-5&&p.cross<p.e.radius+11).sort((a,b)=>a.along-b.along);
    for(const {e} of candidates.slice(0,g.stats.pierce)) {
      beam(g,{x:ex,y:ey},e,'#d6acff',1.5);hurt(g,e,damage*.7,'pierce');
    }
  }
  emit(g,'fire',{turretId:t.id,x:t.x,y:t.y,critical});
}
export function ability(g,kind) {
  if(!g||g.state!=='running')return false;
  if(kind==='pulse') {
    if(g.energy<35||g.pulseCooldown>0)return false;
    g.energy-=35;g.pulseCooldown=12;g.pulseFlash=.65;g.screenShake=.35;
    const enemies=g.enemies.filter(living);
    for(const e of enemies) {
      // Pulse is a battlefield reset: damages all ships, breaks splitter cores,
      // and buys a little space without making every late wave an instant clear.
      hurt(g,e,12+g.stats.damage*.80,'pulse');
      if(living(e)){e.y=Math.max(-30,e.y-21);e.slow=Math.max(e.slow,1.8);}
    }
    g.effects.push({type:'pulse',x:240,y:635,color:'#90eeff',life:.7,maxLife:.7,radius:20});
    emit(g,'pulse');
    settle(g);return true;
  }
  if(kind==='overdrive') {
    if(g.energy<50||g.overdrive>0||g.overdriveCooldown>0)return false;
    g.energy-=50;g.overdrive=6;g.overdriveCooldown=16;emit(g,'overdrive');return true;
  }
  return false;
}
function settle(g) {
  g.enemies=g.enemies.filter(living);
  if(g.state!=='running'||g.enemies.length)return;
  const bonus=Math.max(0,650+g.wave*75-g.waveBreaches*50);
  g.score+=bonus;g.lastWaveBonus=bonus;
  // A small resupply rewards each cleared sector; all resource changes are capped.
  g.energy=Math.min(g.maxEnergy,g.energy+18);
  g.shield=Math.min(g.maxShield,g.shield+16);
  g.hp=Math.min(g.maxHp,g.hp+3);
  g.beams=[];g.overdrive=0;
  if(g.wave===TOTAL_WAVES) {
    g.state='victory';g.choices=[];
    g.result={wave:g.wave,score:g.score,kills:g.kills,breaches:g.breaches,time:g.time};
    emit(g,'victory');
  } else {
    g.state='upgrade';g.choices=rollChoices(g);
    emit(g,'wave-clear',{wave:g.wave,bonus});
  }
}
function tick(g,input) {
  g.ticks++;g.time=g.ticks*STEP;g.waveTime+=STEP;
  g.overdrive=Math.max(0,g.overdrive-STEP);g.pulseFlash=Math.max(0,g.pulseFlash-STEP);
  g.pulseCooldown=Math.max(0,g.pulseCooldown-STEP);g.overdriveCooldown=Math.max(0,g.overdriveCooldown-STEP);
  g.screenShake=Math.max(0,g.screenShake-STEP);g.comboTimer=Math.max(0,g.comboTimer-STEP);
  if(!g.comboTimer)g.combo=0;
  g.energy=Math.min(g.maxEnergy,g.energy+g.stats.energyRegen*STEP);
  if(g.time-g.lastDamage>5)g.shield=Math.min(g.maxShield,g.shield+g.stats.shieldRegen*STEP);
  g.beams=g.beams.filter(b=>(b.life-=STEP)>0);
  g.effects=g.effects.filter(e=>(e.life-=STEP)>0);
  g.aim={x:clamp(Number.isFinite(input.aimX)?input.aimX:240,0,480),y:clamp(Number.isFinite(input.aimY)?input.aimY:250,0,618),active:Number.isFinite(input.aimX)&&Number.isFinite(input.aimY)};
  for(const e of g.enemies) {
    if(!living(e))continue;
    e.age+=STEP;e.flash=Math.max(0,e.flash-STEP);e.slow=Math.max(0,e.slow-STEP);
    const slow=e.slow>0?Math.max(.38,.76-g.stats.frost*.09):1;
    e.y+=e.speed*slow*STEP;
    e.x=clamp(e.spawnX+Math.sin(e.age*.62+e.phase)*((e.type==='boss')?23:7),e.radius+5,WIDTH-e.radius-5);
    if(e.y+e.radius>=BASE_Y)breach(g,e);
    if(g.state!=='running')break;
  }
  if(g.state!=='running'){g.enemies=g.enemies.filter(living);return;}
  for(const t of g.turrets) {
    t.recoil=Math.max(0,t.recoil-STEP*8);
    t.cooldown-=STEP;
    if(t.cooldown<=0&&input.firing!==false) {
      const target=targetFor(g,t,input);
      if(target){fire(g,t,target,input);t.cooldown+=g.stats.interval/(g.overdrive>0?1.85:1);}
      else t.cooldown=0;
    } else if(input.firing===false) t.cooldown=Math.max(0,t.cooldown);
  }
  settle(g);
}
export function step(g,dt,input={}) {
  if(!g||g.state!=='running'||input?.paused||!Number.isFinite(dt)||dt<=0)return g;
  input=input||{};
  // Discard browser-suspension time rather than allowing an unseen sudden loss.
  g.accumulator+=Math.min(dt,.25);
  while(g.accumulator+1e-10>=STEP&&g.state==='running') {
    g.accumulator-=STEP;
    if(g.accumulator<1e-10)g.accumulator=0;
    tick(g,input);
  }
  if(g.state!=='running')g.accumulator=0;
  return g;
}
