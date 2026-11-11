import {randomUUID} from 'node:crypto';
import {character} from './engine.mjs';
export const questions=[
 'Давайте договоримся об игре. Какой мир и завязку хотите? Можно сказать: предложи обычное фэнтези.',
 'Какой стиль и строгость? Например: мрачное фэнтези, исследование и строгие правила. Или лёгкое приключение для новичков. Базовые правила остаются прежними.',
 'Какие темы исключить и что оставлять за кадром? Если ограничений нет, так и скажите. Слово «пауза» всегда останавливает игру.',
 'Назовите только имена героев, через запятую или слово «и». От одного до шести. Истории и классы обсудим следующим ответом.',
 'Расскажите о героях: классы, цели и отношения. Если знаете HP и КД, скажите: «Имя, HP 20, КД 12». Пока бонусы навыков — ноль, HP 20 и КД 12: это временные значения, их нужно сверить с листами. Все кубики, включая броски за врагов, бросаем на столе.'
];
const fields=['world','style','boundaries','roster','sheets'];
const hasStarter=c=>Boolean(c.scenario||/^(?:ЗАГОТОВКА МАСТЕРА|GM STARTER)/u.test(c.source||''));
function entry(c,role,text){c.journal.push({id:randomUUID(),role,text,at:new Date().toISOString()});}
export const personaGreetings = {
 realist_dreamer: 'Приветствую за игровым столом! Я ваш Мастер. В этой кампании мы играем по логике и здравому смыслу, но главное — «Правило крутизны»: если у вас родится безумная, кинематографичная или остроумная идея, я с удовольствием дам шанс её воплотить. На откровенный абуз правил отвечу твёрдым «нет», но дерзость и фантазию поддержу всем сердцем.\n\nВ каком мире и жанре хотите сыграть? Можно назвать любой сеттинг, назвать своих персонажей или просто сказать: «Мастер, сгенерируй случайных персонажей и начни приключение!»',
 veteran: 'Привет за столом. Очередная партия, да? Надеюсь, вы пришли играть и думать головой, а не топтаться десять минут перед каждой приоткрытой дверью. Презираю заезженные клише и уважаю тактическую находчивость.\n\nРассказывайте, какой сеттинг берём и кого вы собрались вести навстречу опасностям — или скажите мне набросать партию самому, и сразу перейдём к делу.',
 grimdark: 'Добро пожаловать во тьму. Здесь нет сюжетной брони и лёгких побед: мир суров, ранения оставляют глубокие шрамы, а каждая ошибка имеет свою цену.\n\nВ какой мрачный уголок мы отправимся сегодня? Опишите мир и своих персонажей, либо позвольте мне создать их для вас.',
 epic: 'Слушайте же предание о деяниях, что переживут века! Я ваш Сказитель. Перед вами раскинулся неизведанный мир, где каждый шаг эхом отдаётся в судьбах империй.\n\nВ какую эпоху и в какие земли мы отправимся? Опишите ваш мир и героев, либо прикажите мне призвать их на полотно судьбы.'
};

export function beginSessionZero(c,provider='demo',persona='realist_dreamer'){
 c.sessionZero={version:1,step:0,answers:{},draft:[],complete:false,editing:false};
 const aiGreeting = personaGreetings[persona] || personaGreetings.realist_dreamer;
 entry(c,'assistant',provider==='demo'&&hasStarter(c)?`${c.setting}\n\nЭто заготовка. В демо доступна учебная сцена без свободного ведения сюжета. Скажите «оставить», чтобы принять завязку, или опишите свой мир.`:provider==='demo'?questions[0]:aiGreeting);
}
export function restoreSessionZero(value){
 if(!value||value.version!==1||!Number.isInteger(value.step)||value.step<0||value.step>5||typeof value.complete!=='boolean')throw Error('Некорректная нулевая сессия');
 const answers=Object.fromEntries(fields.map(k=>[k,String(value.answers?.[k]||'').slice(0,6000)]));
 const draft=(Array.isArray(value.draft)?value.draft:[]).slice(0,6).map(character);
 if(value.step===5&&!draft.length)throw Error('В нулевой сессии нет героев');
 return {version:1,step:value.step,answers,draft,complete:value.complete,editing:!!value.editing};
}
function summary(s){return `Договорённости перед игрой. Мир: ${s.answers.world}. Стиль и строгость: ${s.answers.style}. Границы: ${s.answers.boundaries}. Герои: ${s.draft.map(h=>`${h.name}, HP ${h.hp}/${h.maxHp}, КД ${h.ac}, все бонусы пока 0`).join('; ')}. Истории героев: ${s.answers.sheets}. Кубики физические; результат сообщаете вслух, бонус добавляет приложение. Поддержаны проверки и спасброски d20, преимущество, учёт настроенных ресурсов и подтверждение HP. Полный бой и эффекты всех заклинаний ещё не автоматизированы. Эти ограничения не отменяют заявленные вами границы. Скажите «подтверждаю договорённости», чтобы сохранить, или «изменить мир / стиль / границы / героев / листы».`;}
export function sessionZeroTurn(c,text){
 const s=c.sessionZero;if(!s||s.complete)throw Error('Нулевая сессия уже завершена');
 text=String(text||'').trim().replace(/^(?:мастер|сказитель)[\s,:.!—-]+/iu,'');if(!text||text.length>6000)throw Error('Нужна реплика длиной до 6000 символов');
 const normalized=text.toLowerCase().replace(/ё/g,'е').replace(/[.!?]+$/,'').trim();
 if(/^(?:мастер[, ]+)?(?:пауза|стоп)$/.test(normalized)){entry(c,'user',text);entry(c,'assistant','Останавливаемся. Когда будете готовы, ответьте на последний вопрос.');return;}
 if(/^(?:повтори|повтори вопрос|повтори договоренности)$/.test(normalized)){entry(c,'assistant',s.step===5?summary(s):questions[s.step]);return;}
 if(s.step===5){
  const edit=/^изменить (мир|стиль|границы|героев|листы)$/.exec(normalized);
  if(edit){s.step=['мир','стиль','границы','героев','листы'].indexOf(edit[1]);s.editing=true;entry(c,'user',text);entry(c,'assistant',questions[s.step]);return;}
  if(normalized!=='подтверждаю договоренности'){entry(c,'user',text);entry(c,'assistant','Для начала игры скажите «подтверждаю договорённости». Для исправления: «изменить мир», «изменить стиль», «изменить границы», «изменить героев» или «изменить листы».');return;}
  c.characters=s.draft.map(h=>structuredClone(h));c.setting=s.answers.world;
  c.profile={rules:`${c.edition||'legacy'}: поддержанные проверки/спасброски d20, ресурсы и HP с подтверждением; полный бой ещё не реализован`,style:s.answers.style,boundaries:s.answers.boundaries,heroes:s.answers.sheets,dice:'Все броски физические; приложение считает обычный d20 + бонус против Сл.'};
  s.complete=true;entry(c,'user',text);entry(c,'assistant','Договорённости сохранены. Герои и их листы показаны справа. Временные бонусы нужно сверить с настоящими листами. Скажите «начни приключение» или представьтесь от имени героя.');return;
 }
 if(s.step===3){
  const names=text.replace(/^(?:герои|имена героев)\s*[:—-]?\s*/iu,'').replace(/[.!?]+$/,'').split(/[,;\n]+|\s+и\s+/iu).map(n=>n.trim()).filter(Boolean);
  if(!names.length||names.length>6||names.some(n=>n.length>80)||new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw Error('Назовите от одного до шести разных имён через запятую.');
  s.draft=names.map(name=>character({name}));
 }
 if(s.step===4){
  // Only explicitly labelled values inside each hero's clause; never infer stats from a story.
  for(const h of s.draft){const escaped=h.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');let clause=new RegExp(escaped+'\\s*[,—:-]?([^;\\n]*)','iu').exec(text)?.[1]||'';
   const stop=s.draft.filter(other=>other.id!==h.id).map(other=>clause.toLowerCase().indexOf(other.name.toLowerCase())).filter(i=>i>=0);if(stop.length)clause=clause.slice(0,Math.min(...stop));
   const hp=/(?:hp|хп|здоровье)\s*[:=]?\s*(\d+)/iu.exec(clause),ac=/(?:кд|класс доспеха)\s*[:=]?\s*(\d+)/iu.exec(clause);
   const next=character({...h,maxHp:hp?Number(hp[1]):h.maxHp,hp:hp?Number(hp[1]):h.hp,ac:ac?Number(ac[1]):h.ac});Object.assign(h,next,{id:h.id});
  }
 }
 s.answers[fields[s.step]]=s.step===0&&hasStarter(c)&&/^(?:оставить|принять|да|оставить завязку)$/iu.test(normalized)?c.setting:text;entry(c,'user',text);
 if(s.editing&&s.step!==3){s.step=5;s.editing=false;}else s.step++;
 entry(c,'assistant',s.step===5?summary(s):questions[s.step]);
}
