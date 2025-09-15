import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

function readPort() {
  try { return parseInt(fs.readFileSync('server_port.txt','utf8').trim()); } catch { return 3000; }
}

const PORT = readPort();
console.log('🔌 Utilisation du port', PORT);

const form = new FormData();
if (!fs.existsSync('test.jpg')) {
  console.error('❌ test.jpg introuvable');
  process.exit(1);
}
form.append('image', fs.createReadStream('test.jpg'));

fetch(`http://127.0.0.1:${PORT}/health`).then(r=>r.json()).then(j=>console.log('💚 Health:', j)).catch(e=>console.warn('⚠️ Health KO:', e.message)).finally(()=>{
  fetch(`http://127.0.0.1:${PORT}/extract`, { method: 'POST', body: form })
    .then(r => r.text())
    .then(t => {
      fs.writeFileSync('dynamic_result.json', t, 'utf8');
      console.log('✅ Résultat écrit dans dynamic_result.json');
    })
    .catch(e => console.error('❌ Erreur extraction:', e.message));
});