import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const form = new FormData();
form.append('image', fs.createReadStream('test.jpg')); // change si le nom diffère

fetch('http://127.0.0.1:3000/extract', { method: 'POST', body: form })
  .then(r => r.json())
  .then(j => {
    fs.writeFileSync('result.json', JSON.stringify(j, null, 2), 'utf8');
    console.log('OK -> result.json');
  })
  .catch(e => console.error('Erreur:', e));