const { Blob, File } = require("node:buffer");

if (typeof globalThis.Blob === "undefined") {
  if (typeof Blob !== "undefined") {
    globalThis.Blob = Blob;
    global.Blob = Blob;
  }
}

if (typeof globalThis.File === "undefined") {
  if (typeof File !== "undefined" && File) {
    globalThis.File = File;
    global.File = File;
  } else {
    class CustomFile {
      constructor(bits, name, options) {
        this.name = name;
        this.bits = bits;
        this.options = options;
        this.lastModified = options?.lastModified || Date.now();
      }
      arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); }
      slice() { return new CustomFile([], this.name); }
      stream() { return {}; }
      text() { return Promise.resolve(""); }
      get size() { return 0; }
      get type() { return ""; }
    }
    globalThis.File = CustomFile;
    global.File = CustomFile;
  }
}
