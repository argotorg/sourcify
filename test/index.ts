
const bytecode = '0xd7720bd77d063a6f36b8a5ca460a22a763c4de28e46a8c09f55ecbc973b907e4'
const b = Buffer.from(bytecode, 'utf-8')
console.log(`b ${b}`)

const s = b.toString('utf-8')
console.log(`s ${s}`)