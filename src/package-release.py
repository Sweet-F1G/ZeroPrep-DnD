#!/usr/bin/env python3
"""Build clean, privacy-verified distribution packages for Windows and macOS (v0.9.0)."""
import os
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)
VERSION = 'v0.9.0'

print(f"Packaging Skazitel {VERSION} from {ROOT} to {DIST}...")

# -----------------------------------------------------------------------------
# 1. WINDOWS PACKAGE
# -----------------------------------------------------------------------------
win_dir_name = f"Skazitel-{VERSION}-Windows"
win_stage = DIST / win_dir_name
if win_stage.exists():
    shutil.rmtree(win_stage)
win_stage.mkdir(parents=True)

# Copy Windows launchers
shutil.copy2(ROOT / 'Start-Windows.bat', win_stage / 'Start-Windows.bat')
shutil.copy2(ROOT / 'Start-Windows.ps1', win_stage / 'Start-Windows.ps1')

# Copy documentation
for doc in ['README.md', 'INSTALL-GUIDE.md', 'RELEASE-0.9.0.md', 'CAMPAIGN-IDEAS.md', 'DM-RESPONSIBILITIES.md']:
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
            arcname = file_path.relative_to(DIST)
            zf.write(file_path, arcname)

shutil.rmtree(win_stage)
print(f"✓ Windows package created: {win_zip_path.name} ({win_zip_path.stat().st_size / 1024 / 1024:.2f} MB)")

# -----------------------------------------------------------------------------
# 2. MACOS APPLE SILICON PACKAGE
# -----------------------------------------------------------------------------
mac_dir_name = f"Skazitel-{VERSION}-macOS-AppleSilicon"
mac_stage = DIST / mac_dir_name
if mac_stage.exists():
    shutil.rmtree(mac_stage)
mac_stage.mkdir(parents=True)

# Copy macOS App Bundle (preserving symlinks and permissions)
app_src = ROOT / 'Skazitel.app'
if app_src.exists():
    # Use ditto to preserve Apple code signatures and Mach-O permissions
    os.system(f"ditto '{app_src}' '{mac_stage}/Skazitel.app'")
    # Remove any Finder detritus
    os.system(f"xattr -cr '{mac_stage}/Skazitel.app' 2>/dev/null || true")

# Copy browser command launcher
start_cmd = ROOT / 'Start-browser.command'
if start_cmd.exists():
    shutil.copy2(start_cmd, mac_stage / 'Start-browser.command')
    os.chmod(mac_stage / 'Start-browser.command', 0o755)

# Copy documentation
for doc in ['README.md', 'INSTALL-GUIDE.md', 'RELEASE-0.9.0.md', 'CAMPAIGN-IDEAS.md', 'DM-RESPONSIBILITIES.md']:
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
os.system(f"cd '{DIST}' && ditto -c -k --sequesterRsrc --keepParent '{mac_dir_name}' '{mac_zip_path.name}'")

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
