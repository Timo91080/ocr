import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

// Simple launcher: ensure venv, install lite deps, start python service, then start node app.

const root = process.cwd();
const pythonDir = path.join(root, 'python_ocr');
const venvDir = path.join(pythonDir, 'venv');
const isWin = process.platform === 'win32';
const pythonExe = isWin ? 'python' : 'python3';

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('exit', code => code === 0 ? resolve() : reject(new Error(cmd+ ' exit ' + code)));
  });
}

async function ensureVenv(){
  if(!existsSync(venvDir)){
    console.log('🧪 Création venv Python...');
    await run(pythonExe, ['-m', 'venv', 'venv'], { cwd: pythonDir });
  }
}

function venvPython(){
  return isWin ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
}

async function installLite(){
  console.log('📦 Installation dépendances (min)...');
  await run(venvPython(), ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: pythonDir });
  const reqFile = existsSync(path.join(pythonDir,'requirements-min.txt')) ? 'requirements-min.txt' : 'requirements-lite.txt';
  await run(venvPython(), ['-m', 'pip', 'install', '-q', '-r', reqFile], { cwd: pythonDir });
  // Installer paddleocr sans tenter PyMuPDF
  try {
    console.log('🔤 Installation paddleocr --no-deps');
    await run(venvPython(), ['-m', 'pip', 'install', '--no-deps', 'paddleocr==2.7.0.3'], { cwd: pythonDir });
  } catch(e){
    console.warn('⚠️ paddleocr installation (no-deps) a échoué:', e.message);
  }
  // Installer dépendances runtime manquantes (shapely, pyclipper, etc.)
  if (existsSync(path.join(pythonDir, 'requirements-hybrid.txt'))){
    console.log('🧩 Installation dépendances runtime PaddleOCR...');
    await run(venvPython(), ['-m', 'pip', 'install', '-q', '-r', 'requirements-hybrid.txt'], { cwd: pythonDir });
  } else {
    console.log('⚠️ requirements-hybrid.txt introuvable (skip)');
  }
  // Forcer protobuf version compatible Windows Paddle (3.20.2)
  console.log('🔧 Alignement protobuf 3.20.2');
  await run(venvPython(), ['-m', 'pip', 'install', '-q', '--upgrade', 'protobuf==3.20.2'], { cwd: pythonDir });
  // Normaliser OpenCV (supprimer versions récentes puis remettre 4.6.0.66)
  console.log('🧽 Normalisation OpenCV (désinstallation versions récentes)...');
  try { await run(venvPython(), ['-m','pip','uninstall','-y','opencv-python','opencv-contrib-python','opencv-python-headless'], { cwd: pythonDir }); } catch {}
  console.log('📦 Réinstallation opencv-contrib-python==4.6.0.66');
  await run(venvPython(), ['-m','pip','install','-q','opencv-contrib-python==4.6.0.66'], { cwd: pythonDir });
  console.log('📋 Résumé versions critiques:');
  await run(venvPython(), ['-c', 'import paddle,cv2,google.protobuf;import google.protobuf.internal.api_implementation as ai;print("paddle",paddle.__version__);print("cv2",cv2.__version__);print("protobuf impl",ai.Type());'], { cwd: pythonDir });
}

async function startPython(){
  console.log('🚀 Démarrage microservice OCR (port 8000)...');
  const py = spawn(venvPython(), ['service.py'], { cwd: pythonDir, stdio: 'inherit', env: { ...process.env, PYMUPDF_SKIP:'1' } });
  py.on('exit', code => {
    console.log('❌ Microservice Python terminé code', code);
    process.exit(code || 1);
  });
}

async function startNode(){
  console.log('🌐 Démarrage serveur Node...');
  const n = spawn('node', ['src/index.js'], { stdio: 'inherit' });
  n.on('exit', code => process.exit(code || 0));
}

const onlyPython = process.argv.includes('--only-python');

(async ()=>{
  try {
    await ensureVenv();
    await installLite();
    await startPython();
    if (!onlyPython){
      setTimeout(()=> startNode(), 1500);
    } else {
      console.log('⏹ Mode only-python: serveur Node non lancé');
    }
  } catch (e) {
    console.error('Erreur lancement hybrid:', e.message);
    process.exit(1);
  }
})();
