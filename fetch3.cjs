const { execSync } = require('child_process');

try {
  const response = execSync('curl -s https://pipedapi.kavin.rocks/streams/ux0Qnn2XEgM').toString();
  const info = JSON.parse(response);
  const audio = info.audioStreams.sort((a,b) => b.bitrate - a.bitrate)[0];
  if (audio && audio.url) {
    execSync(`curl -L "${audio.url}" -o godfather_temp.mp3`);
    execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
    console.log("Success!");
  } else {
    console.error("No audio format found!");
  }
} catch (e) {
  console.error("Error!: ", e.stdout ? e.stdout.toString() : "", e.stderr ? e.stderr.toString() : "", e.message);
}
