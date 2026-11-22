// Story layer: Lena's job briefings and one-liners for Neon Bay Heat.
// Every mission is a job for Lena — she runs this town's work, and the
// player is her new hire. The briefing card appears when a mission starts;
// the completion line is shown when it is done. Plain DOM, no assets.
import { fmtTime } from './util.js';

export const MISSION_BRIEFINGS = {
  race: {
    lines: [
      'Lena: the Solmar crew holds a street race every sunset, and no outsider has ever taken their money.',
      'Go take it.',
    ],
    complete: 'Lena: the Solmar crew is eating your dust. Beautiful driving.',
  },
  getaway: {
    lines: [
      'Lena: two stars on you before the job even starts — the NBPD already knows your face.',
      'Hit the checkpoints and don\'t stop for anyone.',
    ],
    complete: 'Lena: clean getaway. The cops are still chasing a ghost.',
  },
  heist: {
    lines: [
      'Lena: the Solmar truck carries the casino\'s weekend take. Stop it, grab the cash, bring it home.',
      'Scratch the paint all you want — just bring the money.',
    ],
    complete: 'Lena: the weekend take, right on time. You\'re family now.',
  },
  boat: {
    lines: [
      'Lena: my cousin\'s boat is at the pier with a hold full of… souvenirs.',
      'Round the buoys, bring her home, and don\'t ask what\'s in the hold.',
    ],
    complete: 'Lena: souvenirs delivered. My cousin owes you one.',
  },
  trial: {
    lines: [
      'Lena: six rings, a hundred seconds, downtown at night. The crew is betting against you.',
      'Take their money.',
    ],
    complete: 'Lena: a hundred seconds and the crew is broke. That\'s my driver.',
  },
  neon: {
    lines: [
      'Lena: four drops, one night, and every cop in the city is awake. The packages pay double after dark.',
      'Don\'t get cute — just deliver.',
    ],
    complete: 'Lena: four drops, no witnesses, no problems. The night belongs to us.',
  },
};

// Show Lena's briefing card for a mission (top-centre, dismisses itself).
// Called from main.js onMissionStart — never in shot mode.
export function showBriefing(def) {
  const b = MISSION_BRIEFINGS[def.id];
  if (!b) return;
  const root = document.getElementById('hud');
  if (!root) return;
  const old = document.getElementById('briefing-card');
  if (old) old.remove();
  const card = document.createElement('div');
  card.id = 'briefing-card';
  card.style.cssText = 'position:absolute;top:64px;left:50%;transform:translateX(-50%);max-width:520px;'
    + 'background:rgba(10,10,30,0.88);border:1px solid rgba(255,93,162,0.7);border-radius:8px;'
    + 'padding:14px 18px;pointer-events:auto;font-family:Arial,sans-serif;color:#ffe9f6;z-index:20;';
  const title = document.createElement('div');
  title.textContent = def.name + '  ·  LENA';
  title.style.cssText = 'font-family:\'Arial Black\',Arial,sans-serif;font-size:15px;color:#ff5da2;letter-spacing:1px;margin-bottom:6px;';
  card.appendChild(title);
  for (const line of b.lines) {
    const p = document.createElement('div');
    p.textContent = line;
    p.style.cssText = 'font-size:14px;line-height:1.45;margin-bottom:4px;';
    card.appendChild(p);
  }
  const reward = document.createElement('div');
  reward.textContent = 'Reward: $' + def.reward.toLocaleString('en-US')
    + (def.timeLimit ? '  ·  Time limit: ' + fmtTime(def.timeLimit) : '');
  reward.style.cssText = 'font-size:13px;color:#7dff9e;margin-top:6px;';
  card.appendChild(reward);
  const btn = document.createElement('button');
  btn.textContent = 'GO  ▶';
  btn.style.cssText = 'margin-top:10px;font-family:\'Arial Black\',Arial,sans-serif;font-size:14px;color:#fff;'
    + 'background:linear-gradient(180deg,#ff2e88,#c40e66);border:1px solid #ffd166;border-radius:6px;'
    + 'padding:7px 22px;cursor:pointer;';
  card.appendChild(btn);
  const dismiss = () => {
    if (card.parentNode) card.parentNode.removeChild(card);
  };
  btn.addEventListener('click', dismiss);
  card.addEventListener('click', dismiss);
  root.appendChild(card);
  setTimeout(dismiss, 4500);
}

// Lena's one-liner when a job is done (shown with the mission reward).
export function completionLine(id) {
  const b = MISSION_BRIEFINGS[id];
  return b ? b.complete : '';
}
