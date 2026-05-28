const { execSync } = require('child_process');
try {
  execSync('curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o yt-dlp');
  execSync('chmod +x yt-dlp');
  console.log("yt-dlp downloaded");
  const d = execSync('./yt-dlp -f "ba" -x --audio-format mp3 -o "godfather_temp.mp3" https://www.youtube.com/watch?v=ux0Qnn2XEgM');
  console.log("yt dlp output: ", d.toString());
  const f = execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
  console.log("ffmpeg output: ", f.toString());
} catch (e) {
  console.error("Error!: ", e.stdout ? e.stdout.toString() : "", e.stderr ? e.stderr.toString() : "", e.message);
}
