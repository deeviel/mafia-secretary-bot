import { Blob as NodeBlob, File as NodeFile } from "node:buffer";

if (typeof globalThis.Blob === "undefined") {
  if (typeof NodeBlob !== "undefined") {
    (globalThis as any).Blob = NodeBlob;
  }
}

if (typeof globalThis.File === "undefined") {
  if (typeof NodeFile !== "undefined" && NodeFile) {
    (globalThis as any).File = NodeFile;
  } else {
    class CustomFile {
      name: string;
      lastModified: number;
      options: any;
      bits: any[];
      constructor(bits: any[], name: string, options?: any) {
        this.name = name;
        this.bits = bits;
        this.options = options;
        this.lastModified = options?.lastModified || Date.now();
      }
      arrayBuffer() { return Promise.resolve(new ArrayBuffer(0)); }
      slice() { return new CustomFile([], this.name); }
      stream() { return {} as any; }
      text() { return Promise.resolve(""); }
      get size() { return 0; }
      get type() { return ""; }
    }
    (globalThis as any).File = CustomFile;
  }
}
