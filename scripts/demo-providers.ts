// scripts/demo-providers.ts — Demonstrates the provider API endpoints using the stub provider.

import type { Provider } from "../src/providers/contract.js";
import { startServer } from "../src/server.js";
import { stubProvider } from "../test/fixtures/stub-provider.js";

async function main() {
  const registry = new Map<string, Provider>([[stubProvider.id, stubProvider]]);
  const server = startServer(0, undefined, undefined, registry);
  const baseUrl = `http://localhost:${server.port}`;

  console.log(
    `Demo server started at ${baseUrl} with stub provider registered.\n`,
  );

  try {
    // 1. GET /api/providers/manifest
    console.log("1. GET /api/providers/manifest");
    const manifestRes = await fetch(`${baseUrl}/api/providers/manifest`);
    console.log(`Status: ${manifestRes.status}`);
    console.log(JSON.stringify(await manifestRes.json(), null, 2));
    console.log(
      "\n------------------------------------------------------------\n",
    );

    // 2. GET /api/providers/manifest?role=git-host
    console.log("2. GET /api/providers/manifest?role=git-host");
    const filteredRes = await fetch(
      `${baseUrl}/api/providers/manifest?role=git-host`,
    );
    console.log(`Status: ${filteredRes.status}`);
    console.log(JSON.stringify(await filteredRes.json(), null, 2));
    console.log(
      "\n------------------------------------------------------------\n",
    );

    // 3. POST /api/providers/verify (ideal)
    console.log("3. POST /api/providers/verify (ideal configuration)");
    const verifyRes = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        role: "tracker",
        config: {
          host: "https://stub.example",
          apiToken: "valid-secret-token",
          project: "rocket",
        },
      }),
    });
    console.log(`Status: ${verifyRes.status}`);
    console.log(JSON.stringify(await verifyRes.json(), null, 2));
    console.log(
      "\n------------------------------------------------------------\n",
    );

    // 4. POST /api/providers/verify (semantic 409 error)
    console.log(
      "4. POST /api/providers/verify (semantic 409 missing required field)",
    );
    const verifyFailRes = await fetch(`${baseUrl}/api/providers/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "stub",
        role: "tracker",
        config: {
          host: "https://stub.example",
        },
      }),
    });
    console.log(`Status: ${verifyFailRes.status}`);
    console.log(JSON.stringify(await verifyFailRes.json(), null, 2));
    console.log(
      "\n------------------------------------------------------------\n",
    );

    // 5. POST /api/providers/parse-url (recognized)
    console.log("5. POST /api/providers/parse-url (recognized stub URL)");
    const parseUrlRes = await fetch(`${baseUrl}/api/providers/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://stub.example/acme/rocket",
      }),
    });
    console.log(`Status: ${parseUrlRes.status}`);
    console.log(JSON.stringify(await parseUrlRes.json(), null, 2));
    console.log(
      "\n------------------------------------------------------------\n",
    );

    // 6. POST /api/providers/parse-url (unrecognized UNKNOWN envelope)
    console.log("6. POST /api/providers/parse-url (unrecognized URL)");
    const unknownUrlRes = await fetch(`${baseUrl}/api/providers/parse-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://unknown.example/other/project",
      }),
    });
    console.log(`Status: ${unknownUrlRes.status}`);
    console.log(JSON.stringify(await unknownUrlRes.json(), null, 2));
    console.log(
      "\n------------------------------------------------------------\n",
    );
  } finally {
    server.stop(true);
    console.log("Demo server stopped.");
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
