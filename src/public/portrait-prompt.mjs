const compact=(v,n=400)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
const known=v=>v&&!/^(?:внешность\s+)?(?:не установлена|не указан[аоы]?|неизвестн[аоы]?|unknown|not specified)[.!]?$/iu.test(v.trim());
function translateVisual(text){const phrases=[['белая борода','white beard'],['белой бородой','white beard'],['белую бороду','white beard'],['спокойные манеры','calm demeanor'],['полуэльф','half-elf'],['белые волосы','white hair'],['рыжие волосы','red hair'],['тёмные волосы','dark hair'],['темные волосы','dark hair'],['длинные волосы','long hair'],['короткие волосы','short hair'],['посох','wooden staff'],['человек','human'],['дварф','dwarf'],['дворф','dwarf'],['эльф','elf'],['тифлинг','tiefling'],['полурослик','halfling'],['гном','gnome'],['драконорождённый','dragonborn']];for(const [ru,en]of phrases)text=text.replace(new RegExp(ru,'giu'),en);return text;}
export function buildPortraitPrompt(c,heroId){
 const h=c.characters.find(h=>h.id===heroId);if(!h)throw Error('Выберите существующего героя');
 const used=[],details=[],bio=h.bio||{};let appearance=compact(bio.appearance,550);
 if(!known(appearance)){appearance='';// Read only the explicit appearance label inside this hero’s own section.
  const first=h.name.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),section=new RegExp('^##\\s+[^\\n]*'+first+'[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))','imu').exec(c.source||'')?.[1]||'';
  appearance=compact(/(?:\*\*)?Внешность(?:\*\*)?\s*:\s*(?:\*\*)?([^\n]*?)(?=\s*\*\*Характер|$)/imu.exec(section)?.[1]?.replaceAll('**',''),550);
 }
 if(!known(appearance)){appearance=compact(String(h.description||'').split(/[,.;\n]/).filter(t=>/волос|бород|глаз|шрам|рост|лиц|одет|плащ|доспех|брон|носит|прич[её]ск|маск|шлем|hair|beard|eyes|wear|scar|cloak/iu.test(t)).join(', '),550);if(bio.player)appearance=appearance.replaceAll(bio.player,'').trim();}
 if(known(appearance)){details.push('Known appearance: '+translateVisual(appearance));used.push('внешность');}
 const species=compact(bio.species,100)||(/полуэльф|half[- ]elf/iu.test(h.description||'')?'полуэльф':'');
 if(known(species)){details.push('Ancestry: '+translateVisual(species.replace(/\([^)]*\)/g,'').trim()));used.push('народ');}
 const classes=[[/artificer|изобретатель/iu,'artificer, inventive workshop aesthetic'],[/druid|друид/iu,'druid, nature-inspired aesthetic'],[/fighter|воин/iu,'fighter'],[/ranger|следопыт/iu,'ranger'],[/wizard|волшебник/iu,'wizard'],[/rogue|плут/iu,'rogue'],[/cleric|жрец/iu,'cleric'],[/paladin|паладин/iu,'paladin'],[/bard|бард/iu,'bard'],[/barbarian|варвар/iu,'barbarian'],[/monk|монах/iu,'monk'],[/sorcerer|чародей/iu,'sorcerer'],[/warlock|колдун/iu,'warlock']];
 const classVisual=classes.find(([pattern])=>pattern.test(h.className||h.description||''))?.[1];if(classVisual){details.push('Character role: '+classVisual);used.push('класс');}
 if(/circle of stars|круг[а-яё]* зв[её]зд/iu.test(h.className||h.description||''))details.push('Subtle constellation motifs');
 const equipment=(c.inventory||[]).filter(i=>i.carrierId===h.id&&i.equipped).slice(0,4).map(i=>{const name=compact(i.name,90);return /револьвер/iu.test(name)?'experimental revolver':/посох/iu.test(name)?'wooden druidic staff':/кожан/iu.test(name)?'leather armor':/щит/iu.test(name)?'wooden shield':translateVisual(name);});
 if(equipment.length){details.push('Visible equipment: '+equipment.join(', '));used.push('экипировка');}
 const missing=known(appearance)?[]:['Подробная внешность не задана: можно уточнить возраст, волосы, лицо и особые приметы.'];
 const style='Detailed fantasy character portrait, single character, face clearly visible, head and shoulders with a hint of equipment, cinematic painted illustration, atmospheric soft lighting, simple dark background, no text, no lettering, no watermark.';
 const prompt=[style,...details].join('\n').slice(0,1500);
 return {prompt,used,missing,local:true};
}
