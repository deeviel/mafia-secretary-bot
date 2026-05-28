const { execSync } = require('child_process');
async function run() {
  try {
    const res = await fetch('https://api.invidious.io/instances.json');
    const instances = await res.json();
    for (const inst of instances) {
      if (inst[1].api) {
        const uri = inst[1].uri;
        console.log("Trying " + uri);
        try {
          const infoRes = await fetch(uri + '/api/v1/videos/ux0Qnn2XEgM');
          if (!infoRes.ok) continue;
          const info = await infoRes.json();
          if (info.adaptiveFormats) {
             const audio = info.adaptiveFormats.find(f => f.type.startsWith('audio'));
             if (audio && audio.url) {
                execSync(`curl -s -L "${audio.url}" -o godfather_temp.mp3`);
                execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
                console.log("Success with " + uri);
                return;
             }
          }
        } catch (e) {
          // ignore
        }
      }
    }
  } catch(e) { console.error(e) }
}
run();
