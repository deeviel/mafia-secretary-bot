const { execSync } = require('child_process');

try {
  const req = `curl -s -X POST -H 'Accept: application/json' -H 'Content-Type: application/json' -d '{"url":"https://www.youtube.com/watch?v=ux0Qnn2XEgM","isAudioOnly":true}' https://api.cobalt.tools/api/json`;
  const response = execSync(req).toString();
  const info = JSON.parse(response);
  if (info.url) {
    execSync(`curl -L "${info.url}" -o godfather_temp.mp3`);
    execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
    console.log("Success!");
  } else {
    console.error("Failed!", info);
  }
} catch (e) {
  console.error("Error!: ", e.stdout ? e.stdout.toString() : "", e.stderr ? e.stderr.toString() : "", e.message);
}
