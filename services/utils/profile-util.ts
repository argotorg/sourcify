export function heapDump(fullFilePath, delay = 5 * 60 * 1000) {
    const heapdump = require('heapdump');
    console.log(`schedule heap dump, interval: ${delay}`)
    const dest = `${fullFilePath}.heapsnapshot`

    setTimeout(() => {
        heapdump.writeSnapshot(dest)
        console.log(`heap dump writen to ${dest}`)
    }, delay)
}