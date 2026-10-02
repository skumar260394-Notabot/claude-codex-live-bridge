"""Build reproducible local-client packages from repository sources."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PLUGIN = ROOT / 'plugins/lovestory'
VERSION = json.loads((PLUGIN / 'plugin.json').read_text(encoding='utf-8'))['version']
SHARED = ('common.mjs', 'protocol.mjs', 'desktop-activity.mjs', 'codex-cli.mjs')


def sources(folder):
    return {p.relative_to(folder).as_posix(): p.read_bytes()
            for p in folder.rglob('*') if p.is_file()
            and '__pycache__' not in p.parts and p.suffix != '.pyc'}


def package(path, files):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, 'Corrupt package'
        assert not any(n.startswith('/') or '..' in n.split('/') for n in archive.namelist())


def build():
    output = ROOT / 'dist'
    output.mkdir(exist_ok=True)
    plugin_files = sources(PLUGIN)
    plugin_files['LICENSE'] = (ROOT / 'LICENSE').read_bytes()
    plugin_files['README.md'] = (ROOT / 'README.md').read_bytes()
    extension = sources(ROOT / 'claude/desktop-extension')
    for name in SHARED:
        extension['server/' + name] = (PLUGIN / 'bridge' / name).read_bytes()
    extension['LICENSE'] = (ROOT / 'LICENSE').read_bytes()
    extension['README.md'] = (ROOT / 'docs/INSTALL.md').read_bytes()
    alerts = sources(ROOT / 'claude/alerts')
    alerts['LICENSE'] = (ROOT / 'LICENSE').read_bytes()
    packages = {
        f'lovestory-codex-{VERSION}.zip': plugin_files,
        f'lovestory-desktop-{VERSION}.mcpb': extension,
        f'lovestory-alerts-{VERSION}.zip': alerts,
    }
    for name, files in packages.items():
        package(output / name, files)
    checksums = ''.join(f'{hashlib.sha256((output/name).read_bytes()).hexdigest()}  {name}\n'
                        for name in sorted(packages))
    (output / 'SHA256SUMS.txt').write_text(checksums, encoding='utf-8')
    print(json.dumps({'version': VERSION, 'packages': list(packages), 'deterministic': True}))


if __name__ == '__main__':
    build()
