const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'auth.js']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(output, file));
}
console.log('Built static site in dist/');
