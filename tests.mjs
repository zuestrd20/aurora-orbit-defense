import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame, startWave, chooseUpgrade, step, ability, UPGRADES, STEP, TOTAL_WAVES, BASE_Y} from './engine.mjs';

const offensive = ['chain','turret','damage','rate','pierce','critical','frost','shield','repair','reactor'];
const snapshot = g => JSON.stringify(g);
const urgent = g => g.enemies.reduce((best,e)=>!best||e.y>best.y?e:best,null);
function checkCaps(g) {
  for(const key of ['hp','shield','energy']) {
    const cap=g[`max${key[0].toUpperCase()+key.slice(1)}`];
    assert.ok(Number.isFinite(g[key]),`${key} must be finite`);
    assert.ok(g[key]>=0&&g[key]<=cap,`${key} ${g[key]} exceeds [0, ${cap}]`);
  }
  assert.ok(g.enemies.every(e=>Number.isFinite(e.x)&&Number.isFinite(e.y)&&Number.isFinite(e.hp)));
  assert.ok(g.events.length<=100);
  assert.ok(g.beams.length<1000);
  assert.ok(g.effects.length<1000);
}
/** This bot uses precisely the actions exposed to the actual player. Never sets
 * game state, hp, damage, wave, choices, or any other simulation fields. */
function campaign(seed,{skills=true,upgrades=true,aim=true,firing=true,preference=offensive,observe=()=>{}}={}) {
  const g=createGame(seed), trace=[];
  assert.equal(startWave(g),true);
  for(let frame=0;frame<60*600&&!['victory','defeat'].includes(g.state);frame++) {
    if(g.state==='upgrade') {
      assert.equal(g.choices.length,3);
      assert.equal(new Set(g.choices).size,3);
      assert.ok(g.choices.every(id=>UPGRADES[id]&&g.upgrades[id]<UPGRADES[id].maxStacks));
      if(upgrades) {
        const id=[...g.choices].sort((a,b)=>preference.indexOf(a)-preference.indexOf(b))[0];
        const before=structuredClone(g);
        assert.equal(chooseUpgrade(g,id),true);
        trace.push(id);
        observe(g,{type:'upgrade',id,before});
      } else assert.equal(startWave(g),true);
    }
    const enemy=urgent(g);
    if(skills&&g.enemies.length>10&&g.energy>=35&&g.waveTime>1) ability(g,'pulse');
    if(skills&&g.enemies.some(e=>e.type==='boss')&&g.energy>=50) ability(g,'overdrive');
    step(g,STEP,aim&&enemy?{aimX:enemy.x,aimY:enemy.y,firing}:{firing});
    if(frame%60===0)checkCaps(g);
    observe(g,{type:'frame',frame});
  }
  checkCaps(g);
  assert.ok(['victory','defeat'].includes(g.state),'campaign exceeded simulation deadline');
  return {g,trace};
}

test('initial state is clean, serializable, and reproducible',()=>{
  const g=createGame(27);
  assert.equal(g.state,'title');assert.equal(g.wave,1);assert.equal(g.hp,100);
  assert.equal(g.turrets.length,3);assert.equal(g.enemies.length,0);
  assert.deepEqual(g,createGame(27));assert.notDeepEqual(g,createGame(28));
  assert.deepEqual(g,JSON.parse(snapshot(g)));checkCaps(g);
});

test('title and invalid actions are inert',()=>{
  const g=createGame(27),before=snapshot(g);
  assert.equal(ability(g,'pulse'),false);assert.equal(ability(g,'overdrive'),false);
  assert.equal(chooseUpgrade(g,'damage'),false);
  step(g,10,{aimX:23,aimY:34});
  assert.equal(snapshot(g),before);
  assert.equal(startWave(g),true);
  const active=snapshot(g);
  assert.equal(startWave(g),false);assert.equal(chooseUpgrade(g,'damage'),false);
  assert.equal(ability(g,'made-up-power'),false);assert.equal(snapshot(g),active);
});

test('first formation has distinct concentric rings and descending ships',()=>{
  const g=createGame(6);startWave(g);
  assert.equal(new Set(g.enemies.map(e=>e.ring)).size,3);
  assert.equal(g.enemies.length,27);
  const initial=g.enemies.map(e=>({id:e.id,y:e.y}));
  for(let i=0;i<60;i++)step(g,STEP,{firing:false});
  for(const first of initial)assert.ok(g.enemies.find(e=>e.id===first.id).y>first.y);
  assert.ok(g.enemies.every(e=>e.y<BASE_Y));
});

test('auto-fire works without pointer input and produces visible beams',()=>{
  const g=createGame(2);startWave(g);
  step(g,STEP);
  assert.ok(g.beams.length>0);
  for(const beam of g.beams)for(const key of ['x1','y1','x2','y2','life'])assert.ok(Number.isFinite(beam[key]));
  for(let i=0;i<300;i++)step(g,STEP);
  assert.ok(g.kills>0);assert.ok(g.score>0);
});

test('aim focus is a real damage bonus',()=>{
  const focused=createGame(2),automatic=createGame(2);startWave(focused);startWave(automatic);
  const aim=urgent(focused);
  step(focused,STEP,{aimX:aim.x,aimY:aim.y});step(automatic,STEP);
  const focusedHp=focused.enemies.reduce((n,e)=>n+e.hp,0);
  const autoHp=automatic.enemies.reduce((n,e)=>n+e.hp,0);
  assert.ok(focusedHp<autoHp,'focus must remove more enemy HP on the same initial shot');
});

test('fixed simulation produces identical results at 30 Hz and 60 Hz',()=>{
  const a=createGame(9),b=createGame(9);startWave(a);startWave(b);
  for(let i=0;i<300;i++)step(a,1/60,{aimX:240,aimY:280});
  for(let i=0;i<150;i++)step(b,1/30,{aimX:240,aimY:280});
  assert.deepEqual(a,b);
});

test('pause and invalid deltas preserve every game field',()=>{
  const g=createGame(9);startWave(g);step(g,.1);
  const before=snapshot(g);
  for(let i=0;i<100;i++)step(g,1/60,{paused:true,aimX:40,aimY:650});
  for(const bad of [NaN,Infinity,-Infinity,-1,0])step(g,bad);
  assert.equal(snapshot(g),before);
});

test('browser suspension cannot skip unseen gameplay',()=>{
  const a=createGame(4),b=createGame(4);startWave(a);startWave(b);
  step(a,3600);step(b,.25);assert.deepEqual(a,b);
});

test('abilities require energy and cooldowns; repeated clicks do not stack',()=>{
  const g=createGame(22);startWave(g);
  assert.equal(ability(g,'overdrive'),true);assert.equal(g.energy,20);assert.equal(g.overdrive,6);
  let before=snapshot(g);assert.equal(ability(g,'overdrive'),false);assert.equal(snapshot(g),before);
  assert.equal(ability(g,'pulse'),false);assert.equal(snapshot(g),before);
  const pulse=createGame(22);startWave(pulse);
  assert.equal(ability(pulse,'pulse'),true);assert.equal(pulse.energy,35);assert.equal(pulse.pulseCooldown,12);
  before=snapshot(pulse);assert.equal(ability(pulse,'pulse'),false);assert.equal(snapshot(pulse),before);
  checkCaps(g);checkCaps(pulse);
});

test('unarmed defense loses through normal enemy impacts',()=>{
  const {g}=campaign(1,{skills:false,upgrades:false,aim:false,firing:false});
  assert.equal(g.state,'defeat');assert.equal(g.wave,1);assert.equal(g.hp,0);
  assert.ok(g.breaches>0);assert.equal(g.kills,0);assert.ok(g.time>20&&g.time<50);
  const before=snapshot(g);step(g,10);assert.equal(startWave(g),false);assert.equal(ability(g,'pulse'),false);
  assert.equal(snapshot(g),before);
});

test('stock auto-turrets without upgrades or abilities cannot win the campaign',()=>{
  const {g}=campaign(1,{skills:false,upgrades:false,aim:false});
  assert.equal(g.state,'defeat');assert.ok(g.wave>=3&&g.wave<12);assert.ok(g.kills>0);
  assert.ok(Object.values(g.upgrades).every(n=>n===0));
});

test('complete 12-wave victories use only legal aim, upgrades, and abilities on 32 seeds',()=>{
  for(let seed=1;seed<=32;seed++) {
    const {g,trace}=campaign(seed);
    assert.equal(g.state,'victory',`seed ${seed} lost at wave ${g.wave}`);
    assert.equal(g.wave,TOTAL_WAVES);assert.equal(trace.length,11);assert.equal(g.enemies.length,0);
    assert.equal(g.result.score,g.score);assert.ok(g.kills>400);assert.ok(g.time>60);
    assert.equal(g.choices.length,0);
    const before=snapshot(g);step(g,1);assert.equal(startWave(g),false);assert.equal(chooseUpgrade(g,'damage'),false);
    assert.equal(snapshot(g),before);
  }
});

test('campaign replays include deterministic upgrade choices, score, and end state',()=>{
  const first=campaign(2026),second=campaign(2026);
  assert.deepEqual(first,second);
});

test('all ten upgrades are reachable and change their advertised mechanical stats',()=>{
  for(const id of Object.keys(UPGRADES)) {
    let obtained=false;
    campaign(8,{preference:[id,...offensive.filter(other=>other!==id)],observe(g,event){
      if(event.type!=='upgrade'||event.id!==id)return;
      const b=event.before;obtained=true;
      assert.equal(g.upgrades[id],b.upgrades[id]+1);
      switch(id){
        case 'damage':assert.ok(g.stats.damage>b.stats.damage);break;
        case 'rate':assert.ok(g.stats.interval<b.stats.interval);break;
        case 'chain':assert.equal(g.stats.chain,b.stats.chain+1);break;
        case 'pierce':assert.equal(g.stats.pierce,b.stats.pierce+1);break;
        case 'frost':assert.equal(g.stats.frost,b.stats.frost+1);break;
        case 'turret':assert.equal(g.turrets.length,b.turrets.length+1);break;
        case 'repair':assert.equal(g.maxHp,b.maxHp+12);assert.equal(g.hp,Math.min(g.maxHp,b.hp+40));assert.equal(g.shield,g.maxShield);break;
        case 'shield':assert.equal(g.maxShield,b.maxShield+25);assert.equal(g.shield,g.maxShield);break;
        case 'reactor':assert.equal(g.maxEnergy,b.maxEnergy+15);assert.ok(g.stats.energyRegen>b.stats.energyRegen);break;
        case 'critical':assert.ok(g.stats.critical>b.stats.critical);break;
      }
    }});
    assert.ok(obtained,`${id} must be offered during a legal campaign`);
  }
});

test('boss waves and splitter fragments occur in normal campaign progression',()=>{
  const bossWaves=new Set();let shards=false,slowed=false;
  campaign(1,{skills:false,observe(g){
    for(const e of g.enemies){if(e.type==='boss')bossWaves.add(g.wave);if(e.split)shards=true;if(e.slow>0)slowed=true;}
  }});
  assert.deepEqual([...bossWaves],[4,8,12]);assert.equal(shards,true);
});

test('intermission refuses unoffered upgrades without changing RNG or resources',()=>{
  const g=createGame(13);startWave(g);
  while(g.state==='running'){const e=urgent(g);step(g,STEP,{aimX:e.x,aimY:e.y});}
  assert.equal(g.state,'upgrade');
  const before=snapshot(g),notOffered=Object.keys(UPGRADES).find(id=>!g.choices.includes(id));
  assert.equal(chooseUpgrade(g,notOffered),false);assert.equal(chooseUpgrade(g,'__proto__'),false);
  step(g,10);assert.equal(snapshot(g),before);
  const offered=g.choices[0];assert.equal(chooseUpgrade(g,offered),true);
  assert.equal(g.wave,2);assert.equal(g.state,'running');assert.equal(g.upgrades[offered],1);
  assert.equal(chooseUpgrade(g,offered),false);
});
