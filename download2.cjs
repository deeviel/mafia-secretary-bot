const { execSync } = require('child_process');
try {
  const out = execSync('./yt-dlp -f "ba" -x --audio-format mp3 -o "godfather_temp.mp3" https://www.youtube.com/watch?v=ux0Qnn2XEgM');
  console.log(out.toString());
} catch(e) {
  console.error(e.stdout.toString(), e.stderr.toString());
}
