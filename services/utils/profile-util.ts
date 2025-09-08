export async function heapDump(fullFilePath: string, delay = 5 * 60 * 1000) {
  const heapdump = await import("heapdump");
  console.log(`schedule heap dump, interval: ${delay}`);
  const dest = `${fullFilePath}.heapsnapshot`;

  setTimeout(() => {
    heapdump.writeSnapshot(dest);
    console.log(`heap dump writen to ${dest}`);
  }, delay);
}
