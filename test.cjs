const { execSync } = require('child_process');
try {
  const out = execSync('chmod +x yt-dlp && ./yt-dlp --version');
  console.log(out.toString());
} catch(e) {
  console.error(e.message);
}
