#!/usr/bin/env python3
"""Build the redistributable Apple Silicon package from explicit, public inputs only."""
from pathlib import Path
import hashlib,json,os,plistlib,re,shutil,subprocess,tempfile
SRC=Path(__file__).resolve().parent
OUT=SRC.parent.parent/'Installers';OUT.mkdir(exist_ok=True)
STAGE=Path(tempfile.mkdtemp(prefix='skazitel-installer-',dir='/private/tmp'))
APP=STAGE/'payload/Skazitel.app';RES=APP/'Contents/Resources';CODE=RES/'src'
PYTHON=Path(os.environ.get('SKAZITEL_PYTHON', '/Users/sweet_f1g/.cache/codex-runtimes/codex-primary-runtime/dependencies/python'))
NODE=Path(os.environ.get('SKAZITEL_NODE', '/Users/sweet_f1g/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'))
VOICE=Path(os.environ.get('SKAZITEL_VOICE_SOURCE',str(SRC.parent/'LocalVoice')))
CACHE=Path(os.environ.get('SKAZITEL_BUILD_CACHE','/private/tmp/skazitel-installer-swift-cache'));CACHE.mkdir(exist_ok=True)
VERSION='0.7.0'
def run(*args):subprocess.run([str(a) for a in args],check=True)
def write(path,text):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text)
CODE.mkdir(parents=True);(APP/'Contents/MacOS').mkdir()
for name in ['server.mjs','audio-stream.mjs','response-stream.mjs','maps.mjs','openai-context.mjs','cost.mjs','progression.mjs','dm-state.mjs','illustrations.mjs','rules.mjs','memory.mjs','inventory.mjs','actions.mjs','prompts.mjs','campaign-store.mjs','engine.mjs','session-zero.mjs','providers.mjs','credentials.mjs','usage.mjs','context.mjs','delivery.mjs','local-voice.mjs','edge-voice.mjs','edge-worker.py','silero-worker.py','voice_text.py','package.json']:
 shutil.copy2(SRC/name,CODE/name)
shutil.copytree(SRC/'public',CODE/'public')
# Never copy Saves, samples, seed campaigns, screenshots, legacy nested apps or local settings.
p=CODE/'server.mjs';text=p.read_text();start=text.index('   if(b.seed){');end=text.index('   await commitCampaign(c);',start)
text=text[:start]+"   if(b.seed)throw Error('Создайте свою кампанию или импортируйте сохранение.');\n   c=makeCampaign({...b,characters:Array.isArray(b.characters)?b.characters:[]});\n   if(b.sessionZero===true)beginSessionZero(c);\n"+text[end:];p.write_text(text)
p=CODE/'public/index.html';text=p.read_text();text=re.sub(r'<button[^>]+id="(?:seed|welcomeSeed)"[^>]*>.*?</button>','',text);text=re.sub(r'v0\.2\.\d+', 'v'+VERSION,text);p.write_text(text)
p=CODE/'public/app.js';text=p.read_text().replace(",'seed'",'');text=re.sub(r"\$\('seed'\)\.onclick=\$\('welcomeSeed'\)\.onclick=.*?;\n",'',text);text=text.replace('Теон, сделайте','Сделайте');text=text.replace("compatible:['','https://openrouter.ai/api/v1']", "compatible:['openai/gpt-oss-120b','https://api.groq.com/openai/v1']");p.write_text(text)
p=CODE/'providers.mjs';text=p.read_text().replace("model:'gpt-4.1-mini',baseUrl:'https://api.openai.com/v1',sttProvider:'openai',sttModel:'gpt-4o-mini-transcribe',ttsProvider:'system'", "model:'openai/gpt-oss-120b',baseUrl:'https://api.groq.com/openai/v1',sttProvider:'groq',sttModel:'whisper-large-v3-turbo',ttsProvider:'silero'").replace("sileroSpeaker:'eugene'", "sileroSpeaker:'baya'");p.write_text(text)
for f in CODE.rglob('*'):
 if f.is_file():
  text=f.read_text();assert not re.search(r'теон|альвари|theon|gsk_[A-Za-z0-9]{15}',text,re.I),str(f)
# Native shell uses Application Support, while portable developer builds keep their old Saves folder.
main=STAGE/'main.swift';write(main,(SRC/'Keychain.swift').read_text()+(SRC/'MacApp.swift').read_text())
run('swiftc','-O','-module-cache-path',CACHE,main,'-o',APP/'Contents/MacOS/Skazitel','-framework','Cocoa','-framework','WebKit','-framework','AVFoundation','-framework','CFNetwork','-framework','Security')
shutil.copy2(NODE,RES/'node');shutil.copy2(SRC/'assets/Skazitel.icns',RES/'Skazitel.icns')
helper=RES/'KeyStore.app';(helper/'Contents/MacOS').mkdir(parents=True)
keymain=STAGE/'key-helper/main.swift';write(keymain,(SRC/'Keychain.swift').read_text()+'\nif !handleCredentialCommand() { exit(1) }\n')
run('swiftc','-O','-module-cache-path',CACHE,keymain,'-o',helper/'Contents/MacOS/Skazitel','-framework','Security')
with (helper/'Contents/Info.plist').open('wb') as f:plistlib.dump(dict(CFBundleExecutable='Skazitel',CFBundleIdentifier='local.skazitel.key-store',CFBundleName='Сказитель — ключи',CFBundlePackageType='APPL',LSUIElement=True),f)
with (APP/'Contents/Info.plist').open('wb') as f:plistlib.dump(dict(CFBundleExecutable='Skazitel',CFBundleIdentifier='local.skazitel.demo',CFBundleName='Сказитель',CFBundleDisplayName='Сказитель',CFBundleIconFile='Skazitel.icns',CFBundleVersion='7',CFBundleShortVersionString=VERSION,CFBundlePackageType='APPL',LSMinimumSystemVersion='14.0',NSMicrophoneUsageDescription='Распознавать игровые реплики по кнопке или при включённом постоянном прослушивании.',NSAppTransportSecurity={'NSAllowsLocalNetworking':True},NSHighResolutionCapable=True,SkazitelInstalledLayout=True),f)
local=RES/'LocalVoice';local.mkdir();shutil.copytree(VOICE/'models',local/'models')
for name in ['Silero-LICENSE.txt','requirements.lock.txt','manifest.json']:shutil.copy2(VOICE/name,local/name)
manifest=json.loads((local/'manifest.json').read_text());assert hashlib.sha256((local/'models/silero-ru.pt').read_bytes()).hexdigest()==manifest['sha256'];manifest['runtime']='python/bin/python3';write(local/'manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2))
# Copy the standalone interpreter and the already verified synthesis dependencies, not a machine-specific venv.
def ignore_base(directory,names):return [n for n in names if n in {'__pycache__','.DS_Store','site-packages','test','tests','idlelib','ensurepip','pkgconfig'} or n.endswith(('.pyc','.pyo'))]
python=local/'python';shutil.copytree(PYTHON/'lib',python/'lib',ignore=ignore_base,symlinks=True);(python/'bin').mkdir();shutil.copy2(PYTHON/'bin/python3.12',python/'bin/python3.12');os.symlink('python3.12',python/'bin/python3')
shutil.copytree(VOICE/'venv/lib/python3.12/site-packages',python/'lib/python3.12/site-packages',ignore=lambda d,ns:[n for n in ns if n in {'__pycache__','.DS_Store','pip'} or n.startswith('pip-') or n.endswith(('.pyc','.pyo'))],symlinks=True)
# Preserve dependency licenses, including the Node distribution license.
licenses=RES/'Licenses';licenses.mkdir();shutil.copy2(local/'Silero-LICENSE.txt',licenses/'Silero-CC-BY-NC-SA-4.0.txt');shutil.copy2(python/'lib/python3.12/LICENSE.txt',licenses/'Python.txt')
node_license=SRC/'assets/Node-LICENSE.txt'
shutil.copy2(node_license,licenses/'Node.txt')
write(licenses/'Third-Party-Notices.txt','''Сказитель: локальная озвучка Silero TTS v5.6 (русский язык).\nАвторы модели: Silero Team / snakers4. Модель не изменена.\nhttps://github.com/snakers4/silero-models\nhttps://models.silero.ai/models/tts/ru/v5_6_ru.pt\nЛицензия модели: CC BY-NC-SA 4.0, текст приложен. Эта сборка предназначена для некоммерческого использования.\nPython: Python Software Foundation. PyTorch: PyTorch contributors (BSD).\nПолные лицензии библиотек находятся в LocalVoice/python/lib/python3.12/site-packages/*dist-info и внутри пакетов.\nNode.js: Node.js contributors; https://nodejs.org/.\n''')
for f in APP.rglob('*'):
 if f.is_symlink():assert not os.path.isabs(os.readlink(f)),str(f)
 assert f.name not in {'Saves','seed','samples','settings.json','campaigns.json','usage.json','credentials.json'},str(f)
run('xattr','-cr',APP)
run('codesign','--force','--sign','-',helper)
run('codesign','--force','--sign','-',APP)
run('codesign','--verify','--deep','--strict',APP)
resources=STAGE/'installer-resources';resources.mkdir()
write(resources/'Welcome.html','''<html><meta charset="utf-8"><body><h1>Сказитель</h1><p>Голосовой ведущий настольных приключений.</p><p>Всё для локальной озвучки Silero уже включено: модель, Python и библиотеки. Загрузка дополнительных компонентов не нужна.</p><p>Для Mac с Apple Silicon (M1 и новее), macOS 14 и новее.</p><p>После установки откройте «Сказитель» в папке «Программы». Создайте свою кампанию и добавьте API-ключи в «Модели и голос».</p></body></html>''')
write(resources/'ReadMe.html','''<html><meta charset="utf-8"><body><h2>Первый запуск</h2><p>Приложение устанавливается в /Applications/Skazitel.app. API-ключи, пользовательские кампании и история игр в установщик не включены.</p><p>Ключи хранятся в Связке ключей macOS. Сохранения: ~/Library/Application Support/Skazitel/Saves. Обновление приложения не удаляет их.</p><p>Локальная озвучка работает без интернета. Для облачного ведущего и распознавания речи нужны интернет и собственные API-ключи. Микрофон разрешается при первом использовании.</p><p>Модель Silero распространяется без изменений на условиях CC BY-NC-SA 4.0. Используйте эту сборку некоммерчески; лицензии находятся внутри приложения, Contents/Resources/Licenses.</p><p>Сборка не подписана сертификатом Developer ID и не нотариализована Apple.</p></body></html>''')
component=STAGE/'Skazitel-component.pkg'
components=STAGE/'Components.plist'
run('pkgbuild','--analyze','--root',STAGE/'payload',components)
with components.open('rb') as f:bundles=plistlib.load(f)
for bundle in bundles:bundle['BundleIsRelocatable']=False;bundle['BundleOverwriteAction']='upgrade'
with components.open('wb') as f:plistlib.dump(bundles,f)
run('pkgbuild','--root',STAGE/'payload','--identifier','local.skazitel.installer','--version',VERSION,'--install-location','/Applications','--ownership','recommended','--component-plist',components,component)
distribution=STAGE/'Distribution.xml'
write(distribution,f'''<?xml version="1.0" encoding="utf-8"?><installer-gui-script minSpecVersion="2"><title>Сказитель {VERSION}</title><welcome file="Welcome.html" mime-type="text/html"/><readme file="ReadMe.html" mime-type="text/html"/><options customize="never" require-scripts="false" hostArchitectures="arm64"/><volume-check script="true"><allowed-os-versions><os-version min="14.0"/></allowed-os-versions></volume-check><domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/><choices-outline><line choice="app"/></choices-outline><choice id="app" visible="false"><pkg-ref id="local.skazitel.installer"/></choice><pkg-ref id="local.skazitel.installer" version="{VERSION}" onConclusion="none">Skazitel-component.pkg</pkg-ref></installer-gui-script>''')
package=OUT/f'Skazitel-{VERSION}-macOS-AppleSilicon.pkg'
run('productbuild','--distribution',distribution,'--resources',resources,'--package-path',STAGE,package)
write(OUT/(package.name+'.sha256'),hashlib.sha256(package.read_bytes()).hexdigest()+'  '+package.name+'\n')
write(STAGE/'BUILD_COMPLETE',str(package))
print('STAGE='+str(STAGE),flush=True);print('INSTALLER='+str(package),flush=True)
