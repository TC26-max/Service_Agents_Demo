#!/usr/bin/env node
// test/serve.mjs: serves the built page with the repo harness (deploy headers, compression, real handlers,
// provider mocked) until stopped. Handy for Lighthouse or a manual look: node test/serve.mjs [port]
import { startHarness } from "./lib.mjs";
const H = await startHarness({ port: +(process.argv[2] || 8820) }); console.log("serving " + H.base);
