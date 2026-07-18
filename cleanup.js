const fs = require('fs');
const path = require('path');

const filesToDelete = ['fix-proxy.js', 'fix-cards.js', 'test-delete.js'];

filesToDelete.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
    console.log('Deleted ' + file);
  }
});

// Rename proxy.ts to middleware.ts
const proxyPath = path.join(__dirname, 'src', 'proxy.ts');
const mwPath = path.join(__dirname, 'src', 'middleware.ts');

if (fs.existsSync(proxyPath)) {
  fs.renameSync(proxyPath, mwPath);
  console.log('Renamed proxy.ts to middleware.ts');
}

console.log('Cleanup complete.');
