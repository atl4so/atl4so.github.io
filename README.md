# kUSDT canceller page

Vyte's phone page for the kUSDT canceller role: https://atl4so.github.io/ (open it in MetaMask's browser).

It reads every call queued in the vaults' AccessManagers on Ethereum and BNB Chain (the last 9 days: the longest wait
plus the week a ready call stays executable) through public nodes, marks the ones a watcher flagged as not announced
(`owner-op-unannounced` in `/api/v1/monitor`), and cancels one with a single MetaMask confirmation. It asks MetaMask
for the account and the network in one permission request, the way that worked on MetaMask Mobile. It sends nothing
else.

`?practice` runs the same page against the Sepolia practice AccessManager (test coins).

## Build

`node build.mjs [mainnet deployment.json]` writes `index.html` from `page.html`. Without a deployment the mainnet
networks have no manager and the page says the vaults aren't live yet. On launch day, build with the verified
`deployment.json` (its chains need `vault` and `accessManager`), check the page, then commit and push.

The build reads the AccessManager and vault ABIs from the kusdt checkout (`bridge/evm/artifacts`; run
`npx hardhat compile` in `bridge/evm` if a vault call is reported missing) and refuses a signature that isn't there.
