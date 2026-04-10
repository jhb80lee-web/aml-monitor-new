# AML Monitor Worker

Cloudflare Worker API for the `aml-monitor-new` app.

The local folder name is `worker`, but the deployed Worker name remains `orange-bread-2e13` because the mobile app and update scripts already point to that live endpoint.

## Commands

```bash
npm install
npm run dev
npm test -- --run
npm run deploy
```

## Notes

- Runtime and deployment config live in [wrangler.toml](./wrangler.toml).
- The app consumes the deployed API via [../constants/api.ts](../constants/api.ts).
- GitHub update scripts upload snapshots to this Worker using the existing `WORKER_BASE_URL` secret.
