const { execSync } = require('child_process');
async function run() {
  try {
    // Specifically search for godfather theme by nino rota
    const res = await fetch('https://archive.org/advancedsearch.php?q=title%3A(godfather)+AND+mediatype%3A(audio)&fl[]=identifier&output=json');
    const data = await res.json();
    for (const doc of data.response.docs) {
      if (doc.identifier === "Talking_to_the_Enemy") continue;
      console.log("Checking", doc.identifier);
      try {
        const filesRes = await fetch(`https://archive.org/metadata/${doc.identifier}`);
        const filesData = await filesRes.json();
        const mp3 = filesData.files.find(f => f.name.toLowerCase().includes('godfather') && f.name.endsWith('.mp3'));
        if (mp3) {
          console.log("Found mp3", mp3.name);
          execSync(`curl -s -L "https://archive.org/download/${doc.identifier}/${mp3.name}" -o godfather_temp.mp3`);
          // Verify it's valid
          execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
          console.log("Success with", doc.identifier);
          return;
        }
      } catch (e) { }
    }
  } catch(e) { console.error(e) }
}
run();
