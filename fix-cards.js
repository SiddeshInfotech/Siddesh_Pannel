const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir('src', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    // We only want to remove bg- and dark:bg- from GlassCard className strings.
    content = content.replace(/<GlassCard([^>]*)className=["']([^"']*)["']([^>]*)>/g, (match, before, classNameStr, after) => {
      // Remove bg- classes, dark:bg-, light:bg-
      let newClassName = classNameStr.replace(/(?:dark:|light:)?bg-(?:\[[^\]]*\]|[a-z0-9\/-]+)\s?/g, '').trim();
      return `<GlassCard${before}className="${newClassName}"${after}>`;
    });
    
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated: ' + filePath);
    }
  }
});
console.log('Done');
