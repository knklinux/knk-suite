#!/bin/sh
# ============================================================================
# build-portable.sh — ensambla el ZIP portable de KNK Suite, en un comando,
# para futuras versiones.
#
# Sustituye la cirugía manual de ZIP: toma como ESQUELETO el último ZIP
# portable (node_modules, runtime/node.exe embebido, data/, assets/,
# config.json…) y superpone el código FRESCO del repo:
#
#   * backend/              completo (sin logs, evidencia ni scratch)
#   * frontend/dist/        build actual (corre antes `npm run build`)
#   * knklinux-desktop.exe  el shell Tauri de src-tauri/target/release
#   * LEEME.txt             el del esqueleto + cabecera "Novedades del build"
#
# Con --prune excluye del node_modules copiado lo que el backend no usa en
# producción (footprint verificado en docs/PORTABLE-MAINTENANCE.md):
#   @tauri-apps/cli-win32-x64-msvc, @tauri-apps/cli, concurrently, @xterm/*,
#   rxjs y los fuentes C/C++ de better-sqlite3 y node-pty (sus binarios
#   .node compilados SE CONSERVAN). ~25 MB de ZIP y ~7,500 ficheros menos.
#   Los requires lazy con try/catch (whisper-node, serialport, puppeteer,
#   uuid) no se tocan: la suite degrada con elegancia, pero se quedan.
#
# SIEMPRE verifica el resultado (testzip + marcadores /bootstrap, Repeater,
# bundle dist, runtime, node_modules) y con --boot-test extrae el ZIP, arranca
# su backend con su node embebido en un puerto libre y comprueba
# /api/health 200, /bootstrap 200+cookie knk_token y gate 401 en /api/findings.
#
# Uso:
#   scripts/build-portable.sh [zip-esqueleto] [--prune] [--boot-test]
#
# Ejemplos:
#   scripts/build-portable.sh "$HOME/Desktop/knkLinux-portable-4.2.0-win64.zip" --prune --boot-test
#   scripts/build-portable.sh --boot-test          # esqueleto: el más reciente del Escritorio
#
# Requisitos: node (versión/parse), python 3 (zip), frontend/dist construido
# y el exe del shell en src-tauri/target/release.
# ============================================================================

set -u
IFS='
'

# ── flags ────────────────────────────────────────────────────────────────────
PRUNE=0
BOOT_TEST=0
SKELETON=""
for a in "$@"; do
  case "$a" in
    --prune)     PRUNE=1 ;;
    --boot-test) BOOT_TEST=1 ;;
    --*) echo "build-portable: flag desconocida: $a" >&2; exit 2 ;;
    *)  SKELETON="$a" ;;
  esac
done

# ── localizar repo y esqueleto ───────────────────────────────────────────────
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
REPO=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd) || exit 1
cd "$REPO" || exit 1

VERSION=$(node -p "require('./package.json').version" 2>/dev/null) || {
  echo "build-portable: no puedo leer package.json (¿node en PATH?)" >&2; exit 2; }
ARCH=win64
ROOT="knkLinux-portable"
OUT="dist-portable/knkLinux-portable-${VERSION}-${ARCH}.zip"

if [ -z "$SKELETON" ]; then
  SKELETON=$(ls -t "$HOME/Desktop"/knkLinux-portable-*.zip 2>/dev/null | head -1)
  if [ -z "$SKELETON" ] || [ ! -f "$SKELETON" ]; then
    echo "build-portable: no hay ZIP portable en el Escritorio; pasa la ruta del esqueleto como 1er argumento" >&2
    exit 2
  fi
fi
if [ ! -f "$SKELETON" ]; then
  echo "build-portable: esqueleto no encontrado: $SKELETON" >&2
  exit 2
fi

EXE="src-tauri/target/release/knklinux-desktop.exe"
[ -f "$EXE" ] || { echo "build-portable: falta el shell Tauri ($EXE); constrúyelo antes (npm run tauri:build)" >&2; exit 2; }
[ -f "frontend/dist/index.html" ] || { echo "build-portable: falta frontend/dist — corre antes: npm run build" >&2; exit 2; }
command -v python >/dev/null 2>&1 || { echo "build-portable: python no está en PATH (se usa para zippiar y verificar)" >&2; exit 2; }

echo "== build-portable v$VERSION =="
echo "   esqueleto : $SKELETON"
echo "   repo      : $REPO"
echo "   prune     : $([ "$PRUNE" -eq 1 ] && echo sí || echo no) · boot-test: $([ "$BOOT_TEST" -eq 1 ] && echo sí || echo no)"

# ── sanity: el bundle del dist (referencia para verificación posterior) ──────
BUNDLE=$(node -e "
const m = require('fs').readFileSync('frontend/dist/index.html','utf8').match(/<script[^>]+src=\"([^\"]+)\"/);
if (!m) process.exit(1);
console.log(m[1].split('/').pop());
") || { echo "build-portable: frontend/dist/index.html sin bundle JS" >&2; exit 2; }
echo "   bundle    : $BUNDLE"

# ── 1) ensamblado + 2) verificación (python embebido) ────────────────────────
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/knk-portable-build.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT

cat > "$TMPD/build.py" <<'PYEOF'
import os, sys, re, time, zipfile, hashlib

REPO, SKELETON, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ROOT, PRUNE, = sys.argv[4], sys.argv[5] == '1'
VERSION = sys.argv[6]
P = ROOT + '/'

# Prune determinista: solo se descarta lo que existe en esta lista, y la
# copia del esqueleto recorre SIEMPRE el mismo orden → el diff del ZIP entre
# builds es estable (importante para el secret-check y gitleaks del CI).
PRUNE_PKGS = ('@tauri-apps/cli-win32-x64-msvc', '@tauri-apps/cli', 'concurrently',
              '@xterm/xterm', '@xterm/addon-fit', 'rxjs')
# Fuentes C/C++ de los nativos: fuera. Sus binarios compilados se conservan.
NATIVE_SRC = ('better-sqlite3/src/', 'better-sqlite3/deps/',
              'node-pty/src/', 'node-pty/deps/', 'node-pty/scripts/')

def pruned(rel):
    if rel.startswith(NATIVE_SRC):
        return True
    parts = rel.split('/')
    top = '/'.join(parts[:2]) if parts[0].startswith('@') and len(parts) > 1 else parts[0]
    return top in PRUNE_PKGS

zout = zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=6)
kept = bad = be = fe = pf = 0
pb = 0

old = zipfile.ZipFile(SKELETON)
for info in old.infolist():
    if info.filename.endswith('/') or not info.filename.startswith(P):
        continue
    rel = info.filename[len(P):]
    # del esqueleto se descarta todo lo que se refresca desde el repo
    if rel.startswith('backend/') or rel.startswith('frontend/dist/') \
       or rel == 'knklinux-desktop.exe' or rel == 'LEEME.txt':
        continue
    if PRUNE and rel.startswith('node_modules/') and pruned(rel[len('node_modules/'):]):
        pf += 1; pb += info.file_size
        continue
    try:
        zout.writestr(info, old.read(info.filename))
        kept += 1
    except (zipfile.BadZipFile, OSError) as ex:
        bad += 1
        print('aviso: entrada ilegible del esqueleto, se salta: %s (%s)' % (info.filename, ex))

# backend/ fresco (sin logs ni evidencia)
for dirpath, dirnames, filenames in os.walk(os.path.join(REPO, 'backend')):
    dirnames[:] = sorted(d for d in dirnames if d not in ('node_modules', 'evidencia-poc'))
    for fn in sorted(filenames):
        if fn.endswith(('.log', '.pyc')):
            continue
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, REPO).replace(os.sep, '/')
        zout.write(full, P + rel)
        be += 1

# frontend/dist fresco
dist = os.path.join(REPO, 'frontend', 'dist')
for dirpath, dirnames, filenames in os.walk(dist):
    dirnames.sort()
    for fn in sorted(filenames):
        full = os.path.join(dirpath, fn)
        rel = 'frontend/dist/' + os.path.relpath(full, dist).replace(os.sep, '/')
        zout.write(full, P + rel)
        fe += 1

# shell Tauri
zout.write(os.path.join(REPO, 'src-tauri', 'target', 'release', 'knklinux-desktop.exe'),
           P + 'knklinux-desktop.exe')

# LEEME: texto del esqueleto + cabecera de novedades (idempotente)
leeme = ''
try:
    raw = old.read(P + 'LEEME.txt')
    for enc in ('utf-8', 'cp1252', 'latin-1'):
        try:
            leeme = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
except Exception:
    pass
leeme = re.sub(r'\*\*v[0-9.]+\*\*', '**v%s**' % VERSION, leeme, count=1)
if len(leeme) < 200:
    leeme = '# knkLinux Security Workbench — Edición Portable\n'
extra = ('## Novedades del build\n\n'
         '- Regenerado con `scripts/build-portable.sh` desde master: backend y UI frescos.\n'
         + ('- node_modules podado (--prune): sin toolchains de build ni deps de dev.\n' if PRUNE else '')
         + '\n---\n\n')
if '## Novedades del build' not in leeme:
    leeme = extra + leeme
zout.writestr(zipfile.ZipInfo(P + 'LEEME.txt', time.localtime()[:6]), leeme.encode('utf-8'))
old.close()
zout.close()

h = hashlib.sha256(open(OUT, 'rb').read()).hexdigest()
print('BUILD-OK kept=%d bad-skeleton=%d backend=%d dist=%d pruned_files=%d pruned_mb=%d sha256=%s'
      % (kept, bad, be, fe, pf, pb // (1024 * 1024), h[:16]))
PYEOF

cat > "$TMPD/verify.py" <<'PYEOF'
import sys, zipfile

ZIP, ROOT, BUNDLE = sys.argv[1], sys.argv[2], sys.argv[3]
P = ROOT + '/'
z = zipfile.ZipFile(ZIP)
bad = z.testzip()
if bad is not None:
    print('VERIFY-FAIL entrada corrupta: %s' % bad); sys.exit(1)
names = set(z.namelist())
errors = []
def need(name, why):
    if name not in names:
        errors.append('falta %s (%s)' % (name, why))
need(P + 'backend/index.js', 'backend fresco')
need(P + 'backend/routes.js', 'backend fresco')
need(P + 'frontend/dist/index.html', 'dist fresco')
need(P + 'frontend/dist/assets/' + BUNDLE, 'bundle del dist')
need(P + 'knklinux-desktop.exe', 'shell Tauri')
need(P + 'runtime/node.exe', 'node embebido')
need(P + 'LEEME.txt', 'leeme')
src = z.read(P + 'backend/index.js').decode('utf8', 'ignore')
routes = z.read(P + 'backend/routes.js').decode('utf8', 'ignore')
if "app.get('/bootstrap'" not in src:
    errors.append('backend sin ruta /bootstrap')
if "router.get('/health'" not in routes:
    errors.append('backend sin /api/health (router.get /health)')
if 'repeater' not in src.lower() and 'repeater' not in routes.lower() \
   and not any(n.startswith(P + 'backend/lib/repeater') for n in names):
    errors.append('backend sin módulo Repeater')
html = z.read(P + 'frontend/dist/index.html').decode('utf8', 'ignore')
if BUNDLE not in html:
    errors.append('dist/index.html no referencia el bundle actual')
bundle = z.read(P + 'frontend/dist/assets/' + BUNDLE).decode('utf8', 'ignore')
if 'Repeater' not in bundle:
    errors.append('el bundle no contiene el Repeater')
nm = [n for n in names if n.startswith(P + 'node_modules/')]
if len(nm) < 1500:
    errors.append('node_modules sospechosamente pequeño (%d ficheros)' % len(nm))
if errors:
    print('VERIFY-FAIL')
    for e in errors: print('  -', e)
    sys.exit(1)
print('VERIFY-OK node_modules_files=%d' % len(nm))
PYEOF

mkdir -p dist-portable

echo "== 1) ensamblando =="
python "$TMPD/build.py" "$REPO" "$SKELETON" "$OUT" "$ROOT" "$PRUNE" "$VERSION" || exit 1

echo "== 2) verificando integridad y marcadores =="
python "$TMPD/verify.py" "$OUT" "$ROOT" "$BUNDLE" || exit 1

# ── 3) boot test opcional: el backend DEL ZIP, con su node embebido ─────────
if [ "$BOOT_TEST" -eq 1 ]; then
  echo "== 3) boot test =="
  cat > "$TMPD/boot.py" <<'PYEOF'
import http.cookiejar, json, os, socket, subprocess, sys, tempfile, time, zipfile
import urllib.request, urllib.error

ZIP, ROOT = sys.argv[1], sys.argv[2]
P = ROOT + '/'
z = zipfile.ZipFile(ZIP)

s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
tmp = tempfile.mkdtemp(prefix='knk-portable-boot-')
ex = os.path.join(tmp, 'root')
NEED = ('backend/', 'frontend/dist/', 'node_modules/', 'runtime/', 'data/', 'assets/')
for i in z.infolist():
    if i.filename.endswith('/'):
        continue
    rel = i.filename[len(P):]
    if not (rel.startswith(NEED) or rel in ('config.json', 'package.json')):
        continue
    dest = os.path.join(ex, rel.replace('/', os.sep))
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(z.read(i.filename))

node = os.path.join(ex, 'runtime', 'node.exe')
# KNK_DB aislado: el backend del test usa una BD propia y limpia, nunca
# la real de ~/.knk-suite (sql.js vuelca la BD completa al guardar).
proc = subprocess.Popen([node, os.path.join(ex, 'backend', 'index.js')],
                        env=dict(os.environ, KNK_PORT=str(port), KNK_DB=os.path.join(tmp, 'suite.db')),
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=ex)
base = 'http://127.0.0.1:%d' % port
NOPROXY = urllib.request.ProxyHandler({})
plain = urllib.request.build_opener(NOPROXY)
authed = urllib.request.build_opener(
    NOPROXY, urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
urllib.request.install_opener(plain)

def req(path, method='GET', data=None):
    r2 = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        r2.add_header('Content-Type', 'application/json')
    try:
        resp = authed.open(r2, timeout=8)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

ok = False
for _ in range(60):
    try:
        plain.open(base + '/api/health', timeout=2); ok = True; break
    except Exception:
        if proc.poll() is not None:
            break
        time.sleep(0.5)

errors = []
if not ok:
    errors.append('el backend del ZIP no levantó en 30s (exit=%s)' % proc.poll())
else:
    st, _ = req('/api/health')
    if st != 200: errors.append('/api/health != 200 (%s)' % st)
    try:
        r2 = authed.open(base + '/bootstrap', timeout=8)
        st, hdrs = r2.status, dict(r2.headers)
    except urllib.error.HTTPError as e:
        st, hdrs = e.code, dict(e.headers)
    if st != 200:
        errors.append('/bootstrap != 200 (%s)' % st)
    elif not any('knk_token' in str(v) for v in hdrs.values()):
        errors.append('/bootstrap sin Set-Cookie knk_token')
    else:
        st, body = req('/api/targets', 'POST',
                       b'{"name":"boot-test","scope":[]}')
        tid = None
        try:
            tid = json.loads(body).get('id')
        except Exception:
            pass
        if st != 200 or not tid:
            errors.append('POST /api/targets != 200 con id (%s, id=%r)' % (st, tid))
        else:
            st, body = req('/api/targets')
            listed = tid in json.dumps(json.loads(body or b'[]'))
            if st != 200 or not listed:
                errors.append('GET /api/targets no lista el creado (%s)' % st)
            st, _ = req('/api/targets/%s' % tid, 'DELETE')
            if st != 200:
                errors.append('DELETE /api/targets != 200 (%s)' % st)
    try:
        r2 = plain.open(base + '/api/findings', timeout=8); st = r2.status
    except urllib.error.HTTPError as e:
        st = e.code
    if st != 401:
        errors.append('gate: /api/findings != 401 (%s)' % st)
proc.terminate()
try: proc.wait(timeout=10)
except Exception: proc.kill()

if errors:
    print('BOOT-FAIL port=%d' % port)
    for e in errors: print('  -', e)
    sys.exit(1)
print('BOOT-OK port=%d (targets CRUD incluido)' % port)
PYEOF
  python "$TMPD/boot.py" "$OUT" "$ROOT" || exit 1
fi

echo "== portable listo: $OUT =="
ls -la "$OUT"
