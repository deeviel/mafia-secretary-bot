const { execSync } = require('child_process');
async function run() {
  try {
    const res = await fetch('https://archive.org/advancedsearch.php?q=Godfather+Theme+mp3&fl[]=identifier&output=json');
    const data = await res.json();
    for (const doc of data.response.docs) {
      console.log("Checking", doc.identifier);
      try {
        const filesRes = await fetch(`https://archive.org/metadata/${doc.identifier}`);
        const filesData = await filesRes.json();
        const mp3 = filesData.files.find(f => f.name.endsWith('.mp3'));
        if (mp3) {
          console.log("Found mp3", mp3.name);
          execSync(`curl -s -L "https://archive.org/download/${doc.identifier}/${mp3.name}" -o godfather_temp.mp3`);
          execSync('ffmpeg -y -i godfather_temp.mp3 -ss 00:00:20 -t 15 godfather-theme-15s.mp3');
          console.log("Success!");
          return;
        }
      } catch (e) {
        console.error(e);
      }
    }
  } catch(e) { console.error(e) }
}
run();
