// @ts-check
require('dotenv').config()
const { contracts } = require('@mooncatrescue/contracts/moonCatUtils')
const { initializeFile, writeFileAsync } = require('./lib/fileUtils')
const { getAddress } = require('viem')
const { getPublicClient, sleep } = require('./lib/utils')

const START_BLOCK = 4140409n // https://etherscan.io/tx/0xd31d05adb302131f0c31f1a001685f29eb3b2b66d2af3b90d1e2c7f22661db61
const STEP_SIZE = 50_000n
const BLANK_NAME = '0x0000000000000000000000000000000000000000000000000000000000000000';

const OUTPUT_FILE = 'output/mooncat_named.json'
initializeFile('./' + OUTPUT_FILE)
let namedTxs = require('./' + OUTPUT_FILE)

const redactedNames = ['0x0008d4ecd0']

/**
 * This script looks for the `CatNamed` events and makes a separate output at `mooncat_named.json` to give more details about the
 * naming events specifically.
 */
;(async () => {
  const client = getPublicClient()

  let latestBlock = await client.getBlock({ blockTag: 'latest' })
  let curBlock = START_BLOCK
  let namedCount = 0

  let existingNamed = Object.keys(namedTxs)
  if (existingNamed.length > 0) {
    // Existing cached transactions; jump to the last one already done
    let lastNamed = namedTxs[existingNamed[existingNamed.length - 1]]
    curBlock = BigInt(lastNamed.blockHeight)
    namedCount = lastNamed.namedOrder
  }
  console.log(`Starting at ${curBlock}, with named MoonCat ${namedCount}`)

  const catNamedEvent = contracts.rescue.abi.find((f) => 'name' in f && f.name == 'CatNamed')
  if (typeof catNamedEvent == 'undefined') {
    console.error('Failed to find CatNamed event')
    process.exit(1)
  }
  while (curBlock < latestBlock.number) {
    console.log('at', curBlock)
    const t = sleep(1000)
    const logs = await client.getLogs({
      address: contracts.rescue.address,
      event: catNamedEvent,
      fromBlock: curBlock,
      toBlock: curBlock + STEP_SIZE - 1n,
    })
    console.log(`Found ${logs.length} logs to parse...`)
    for (let i = 0; i < logs.length; i++) {
      const t = sleep(700)
      const log = logs[i]
      if (log.args.catName == BLANK_NAME) {
        // This is not really a naming event; skip
        continue
      }
      const tx = await client.getTransaction({
        hash: log.transactionHash,
      })
      const block = await client.getBlock({
        blockNumber: log.blockNumber,
      })

      namedTxs[log.args.catId] = {
        txHash: log.transactionHash,
        blockHeight: Number(log.blockNumber),
        timestamp: Number(block.timestamp),
        namedOrder: namedCount,
        nameRaw: log.args.catName,
        catId: log.args.catId,
        namer: getAddress(tx.from),
      }

      // Use node Buffer to parse name to see if it's a valid UTF-8 string
      if (redactedNames.includes(log.args.catId)) {
        namedTxs[log.args.catId].name = '\ufffd'
      } else {
        let nameBuffer = Buffer.from(log.args.catName.slice(2), 'hex')
        let firstNull = nameBuffer.indexOf(0x00)
        if (firstNull === 0) {
          // Name starts with a null; not a valid UTF-8 string
          namedTxs[log.args.catId].name = true
        } else {
          if (firstNull >= 0) {
            nameBuffer = nameBuffer.slice(0, firstNull)
          }
          try {
            let nameString = new TextDecoder('utf8', { fatal: true }).decode(nameBuffer)
            namedTxs[log.args.catId].name = nameString
          } catch (err) {
            // Name is not a valid UTF-8 string
            namedTxs[log.args.catId].name = true
          }
        }
      }

      namedCount++
      if (i > 0 && i % 10 == 0) process.stdout.write('.')
      if (i > 0 && i % 100 == 0) {
        console.log('')
        await writeFileAsync(OUTPUT_FILE, JSON.stringify(namedTxs, null, 2))
      }
      await t
    }
    console.log(`${namedCount} named MoonCats found so far...`)

    curBlock += STEP_SIZE
    console.log('')
    await writeFileAsync(OUTPUT_FILE, JSON.stringify(namedTxs, null, 2))
    await t
  }
  await writeFileAsync(OUTPUT_FILE, JSON.stringify(namedTxs, null, 2))
})()
