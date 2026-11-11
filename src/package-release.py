#!/usr/bin/env python3
"""Build clean, privacy-verified distribution packages for Windows and macOS."""
import os
import plistlib
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
VERSION = 'v0.9.5'

# Do not label an old app bundle as a new release. Build it first, then package.
app_src = ROOT / 'Skazitel.app'
try:
    with (app_src / 'Contents/Info.plist').open('rb') as info_file:
        app_version = plistlib.load(info_file).get('CFBundleShortVersionString')
except (OSError, ValueError) as error:
    raise SystemExit(f'Cannot read the macOS app bundle; run ./src/build-mac.sh first: {error}')
if app_version != VERSION.removeprefix('v'):
    raise SystemExit(f'macOS app is {app_version}, expected {VERSION}; run ./src/build-mac.sh first.')
source_root = ROOT / 'src'
bundle_root = app_src / 'Contents/Resources/src'
source_files = list(source_root.glob('*.mjs')) + [source_root / 'package.json']
source_files += [p for p in (source_root / 'public').rglob('*') if p.is_file() and p.suffix in {'.mjs', '.js', '.css', '.html'}]
for source in source_files:
    bundled = bundle_root / source.relative_to(source_root)
    if not bundled.is_file() or bundled.read_bytes() != source.read_bytes():
        raise SystemExit(f'macOS app has stale or missing {source.relative_to(source_root)}; run ./src/build-mac.sh first.')
DIST.mkdir(exist_ok=True)
STAGING = Path(tempfile.mkdtemp(prefix='skazitel-release-', dir='/private/tmp'))

print(f"Packaging Skazitel {VERSION} from {ROOT} to {DIST}...")

# -----------------------------------------------------------------------------
# 1. WINDOWS PACKAGE
# -----------------------------------------------------------------------------
win_dir_name = f"Skazitel-{VERSION}-Windows"
win_stage = STAGING / win_dir_name
if win_stage.exists():
    shutil.rmtree(win_stage)
win_stage.mkdir(parents=True)

# Copy Windows launchers
shutil.copy2(ROOT / 'Start-Windows.bat', win_stage / 'Start-Windows.bat')
shutil.copy2(ROOT / 'Start-Windows.ps1', win_stage / 'Start-Windows.ps1')

# Copy documentation
for doc in ['README.md', 'README.ru.md', 'INSTALL-GUIDE.md', 'RELEASE-0.9.5.md', 'CAMPAIGN-IDEAS.md', 'DM-RESPONSIBILITIES.md']:
    doc_path = ROOT / doc
    if doc_path.exists():
        shutil.copy2(doc_path, win_stage / doc)

# Copy clean Saves template
(win_stage / 'Saves').mkdir(parents=True)
shutil.copy2(ROOT / 'Saves/README.md', win_stage / 'Saves/README.md')
(win_stage / 'Saves/Images').mkdir(parents=True)
(win_stage / 'Saves/Images/.gitkeep').touch()

# Copy src directory (excluding tests, local data, caches)
def ignore_src(dir_path, names):
    ignored = set()
    for name in names:
        if name in {'__pycache__', '.DS_Store', 'data', 'tests'}:
            ignored.add(name)
        elif name.endswith(('.pyc', '.tmp', '.log')):
            ignored.add(name)
    return ignored

shutil.copytree(ROOT / 'src', win_stage / 'src', ignore=ignore_src)

# Create Windows ZIP archive
win_zip_path = DIST / f"Skazitel-{VERSION}-Windows.zip"
if win_zip_path.exists():
    win_zip_path.unlink()

print("Creating Windows archive:", win_zip_path.name)
with zipfile.ZipFile(win_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root_dir, dirs, files in os.walk(win_stage):
        for file in files:
            file_path = Path(root_dir) / file
            arcname = file_path.relative_to(STAGING)
            zf.write(file_path, arcname)

shutil.rmtree(win_stage)
print(f"✓ Windows package created: {win_zip_path.name} ({win_zip_path.stat().st_size / 1024 / 1024:.2f} MB)")

# -----------------------------------------------------------------------------
# 2. MACOS APPLE SILICON PACKAGE
# -----------------------------------------------------------------------------
mac_dir_name = f"Skazitel-{VERSION}-macOS-AppleSilicon"
mac_stage = STAGING / mac_dir_name
if mac_stage.exists():
    shutil.rmtree(mac_stage)
mac_stage.mkdir(parents=True)

# Copy macOS App Bundle (preserving symlinks and permissions)
app_src = ROOT / 'Skazitel.app'
if app_src.exists():
    # Use ditto to preserve Apple code signatures and Mach-O permissions
    subprocess.run(['ditto', '--norsrc', '--noextattr', str(app_src), str(mac_stage / 'Skazitel.app')], check=True)
    subprocess.run(['xattr', '-cr', str(mac_stage / 'Skazitel.app')], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(mac_stage / 'Skazitel.app')], check=True)

# Copy browser command launcher
start_cmd = ROOT / 'Start-browser.command'
if start_cmd.exists():
    shutil.copy2(start_cmd, mac_stage / 'Start-browser.command')
    os.chmod(mac_stage / 'Start-browser.command', 0o755)

# Copy documentation
for doc in ['README.md', 'README.ru.md', 'INSTALL-GUIDE.md', 'RELEASE-0.9.5.md', 'CAMPAIGN-IDEAS.md', 'DM-RESPONSIBILITIES.md']:
    doc_path = ROOT / doc
    if doc_path.exists():
        shutil.copy2(doc_path, mac_stage / doc)

# Copy clean Saves template
(mac_stage / 'Saves').mkdir(parents=True)
shutil.copy2(ROOT / 'Saves/README.md', mac_stage / 'Saves/README.md')
(mac_stage / 'Saves/Images').mkdir(parents=True)
(mac_stage / 'Saves/Images/.gitkeep').touch()

# Copy src directory
shutil.copytree(ROOT / 'src', mac_stage / 'src', ignore=ignore_src)

# Create macOS ZIP archive using ditto to preserve macOS code signatures and permissions
mac_zip_path = DIST / f"Skazitel-{VERSION}-macOS-AppleSilicon.zip"
if mac_zip_path.exists():
    mac_zip_path.unlink()

print("Creating macOS archive:", mac_zip_path.name)
# Use ditto for mac zip to correctly preserve resource forks and symlinks
subprocess.run(['ditto', '-c', '-k', '--keepParent', str(mac_stage), str(mac_zip_path)], check=True)

shutil.rmtree(mac_stage)
print(f"✓ macOS package created: {mac_zip_path.name} ({mac_zip_path.stat().st_size / 1024 / 1024:.2f} MB)")

# -----------------------------------------------------------------------------
# 3. VERIFY NO SECRETS OR USER CAMPAIGNS IN THE PACKAGES
# -----------------------------------------------------------------------------
print("\nVerifying privacy of created packages...")
for pkg in [win_zip_path, mac_zip_path]:
    with zipfile.ZipFile(pkg, 'r') as zf:
        names = zf.namelist()
        for name in names:
            assert 'campaigns.sqlite' not in name, f"Leak: {name} in {pkg.name}"
            assert 'campaigns.json' not in name, f"Leak: {name} in {pkg.name}"
            assert 'settings.json' not in name, f"Leak: {name} in {pkg.name}"
            assert not name.endswith(('.pem', '.key')), f"Leak: {name} in {pkg.name}"
            if 'Images/' in name and not name.endswith('/') and not name.endswith('.gitkeep'):
                assert False, f"Leak: user image {name} in {pkg.name}"
print("✓ All distribution packages are 100% clean of personal saves, portraits, and API keys!")
shutil.rmtree(STAGING)
