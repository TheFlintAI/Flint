#!/usr/bin/env bun

import { buildPlugin, validatePlugin } from './builder/index.js'
import { buildRuntime } from './builder/runtime-builder.js'

const cmd = process.argv[2]
const args = process.argv.slice(3)

async function main() {
  switch (cmd) {
    case 'build': {
      if (args.length < 2) {
        console.error('Usage: flint-plugin build <source-dir> <output.flp>')
        process.exit(1)
      }
      await buildPlugin(args[0], args[1])
      break
    }
    case 'build-runtime': {
      if (args.length < 1) {
        console.error('Usage: flint-plugin build-runtime <output.js>')
        process.exit(1)
      }
      await buildRuntime(args[0])
      break
    }
    case 'validate': {
      if (args.length < 1) {
        console.error('Usage: flint-plugin validate <source-dir>')
        process.exit(1)
      }
      await validatePlugin(args[0])
      break
    }
    default:
      console.error('Usage: flint-plugin <build|build-runtime|validate> <args...>')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('[flint-plugin]', err.message)
  process.exit(1)
})
