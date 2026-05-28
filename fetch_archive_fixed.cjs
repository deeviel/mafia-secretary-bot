const { execSync } = require('child_process');
try {
  execSync(`curl -s -L "https://archive.org/download/godfather_3310/godfather_3310.mp3" -o godfather_temp.mp3`);
  execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:00 -t 15 godfather-theme-15s.mp3');
  console.log("Success with godfather_3310");
} catch (e) { console.error(e) }
