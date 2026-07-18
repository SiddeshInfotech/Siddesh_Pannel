const fs = require('fs');
let content = fs.readFileSync('src/proxy.ts', 'utf8');
content = content.replace(/new URL\('\/', req\.url\)/g, "new URL('/lms-admin/', req.url)");
fs.writeFileSync('src/proxy.ts', content, 'utf8');
console.log('Fixed proxy.ts');
