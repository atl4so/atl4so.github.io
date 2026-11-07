// Builds index.html from page.html: `node build.mjs [mainnet-deployment.json]`.
// Without a deployment the mainnet networks have no manager yet and the page says so; the practice (?practice) is
// the Sepolia test AccessManager set up on 7 November 2026. Selectors come from the signatures below, checked
// against OpenZeppelin's AccessManager ABI in the kusdt checkout.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const KUSDT = '/home/coinathlete/projects/kusdt';
const require = createRequire(KUSDT + '/package.json');
const { ethers } = require('ethers');
const manager = new ethers.Interface(require(KUSDT + '/bridge/evm/artifacts/@openzeppelin/contracts/access/manager/AccessManager.sol/AccessManager.json').abi);

const CANCELLER = '0x5657632648C8fFbF394035a1263E4728e984d542';
const SAFE = '0x69AD98869983757828841c89fd25dCEF440749b1';

// [signature, what it does, the role that may schedule it, [label, display kind] per parameter]
// The vault's owner calls and roles are bridge/evm/scripts/access-manager.ts's; anything on the manager needs ADMIN.
const VAULT_CALLS = [
  ['setSigners(address[5])', "Replace the vault's 5 signers", 'GOVERNOR', [['new signers', 'addrs']]],
  ['setSigners(address[])', "Replace the vault's signers", 'GOVERNOR', [['new signers', 'addrs']]], // the practice's stand-in vault
  ['setFees(uint16,uint256,uint256)', 'Change the bridge fees', 'GOVERNOR', [['fee', 'bps'], ['smallest deposit fee', 'amount'], ['smallest payout fee', 'amount']]],
  ['setDepositLimits(uint256,uint256)', 'Change the deposit limits', 'GOVERNOR', [['smallest deposit', 'amount'], ['largest deposit', 'amount']]],
  ['setReleaseLimits(uint256,uint256)', 'Change the payout limits', 'GOVERNOR', [['capacity', 'amount'], ['refill per second', 'amount']]],
  ['setPayoutDelay(uint64)', 'Change the payout wait', 'GOVERNOR', [['new wait', 'secs']]],
  ['withdrawFees(address,uint256)', 'Withdraw the collected fees', 'GOVERNOR', [['to', 'addr'], ['amount', 'amount']]],
  ['transferOwnership(address)', 'Hand the vault to a new owner', 'GOVERNOR', [['new owner', 'addr']]],
  ['setGuardian(address)', "Change the vault's guardian (who can pause)", 'EMERGENCY', [['new guardian', 'addr']]],
  ['unpause()', 'Unpause the vault', 'EMERGENCY', []],
  ['cancelRelease(bytes32)', 'Cancel a queued payout', 'EMERGENCY', [['payout', 'hash']]],
  ['cancelRefund(uint64)', 'Cancel a queued refund', 'EMERGENCY', [['refund number', 'num']]],
  ['pause()', 'Pause the vault', 'PAUSER', []],
  ['acceptOwnership()', "Accept the vault's ownership", 'ADMIN', []],
];
const MANAGER_CALLS = [
  ['grantRole(uint64,address,uint32)', 'Give a role to an address', 'ADMIN', [['role', 'role'], ['to', 'addr'], ['its wait', 'secs']]],
  ['revokeRole(uint64,address)', 'Take a role away', 'ADMIN', [['role', 'role'], ['from', 'addr']]],
  ['setRoleAdmin(uint64,uint64)', 'Change who manages a role', 'ADMIN', [['role', 'role'], ['new manager role', 'role']]],
  ['setRoleGuardian(uint64,uint64)', "Change who can cancel a role's calls", 'ADMIN', [['role', 'role'], ['new guardian role', 'role']]],
  ['setGrantDelay(uint64,uint32)', "Change a role's grant wait", 'ADMIN', [['role', 'role'], ['new wait', 'secs']]],
  ['setTargetAdminDelay(address,uint32)', "Change a contract's admin wait", 'ADMIN', [['contract', 'addr'], ['new wait', 'secs']]],
  ['setTargetFunctionRole(address,bytes4[],uint64)', 'Change which role may call vault functions', 'ADMIN', [['contract', 'addr'], ['functions', 'sels'], ['role', 'role']]],
  ['setTargetClosed(address,bool)', 'Close or reopen a contract', 'ADMIN', [['contract', 'addr'], ['closed', 'bool']]],
  ['updateAuthority(address,address)', 'Move a contract to another manager', 'ADMIN', [['contract', 'addr'], ['new manager', 'addr']]],
  ['labelRole(uint64,string)', 'Rename a role', 'ADMIN', [['role', 'role'], ['name', 'text']]],
];
const vault = new ethers.Interface(require(KUSDT + '/bridge/evm/artifacts/contracts/KusdtVault.sol/KusdtVault.json').abi);
for (const [sig] of VAULT_CALLS) {
  if (sig !== 'setSigners(address[])' && !vault.getFunction(sig)) throw new Error(`${sig} is not the vault's`);
}
for (const [sig] of MANAGER_CALLS) {
  if (manager.getFunction(sig.slice(0, sig.indexOf('(')))?.format() !== sig) throw new Error(`${sig} is not the AccessManager's`);
}
const CALLS = {};
for (const [sig, label, role, params] of [...VAULT_CALLS, ...MANAGER_CALLS]) {
  const types = sig.slice(sig.indexOf('(') + 1, -1).split(',').filter(Boolean);
  if (types.length !== params.length) throw new Error(`${sig}: ${types.length} types, ${params.length} labels`);
  CALLS[ethers.id(sig).slice(0, 10)] = { name: sig.slice(0, sig.indexOf('(')), label, role, params: params.map(([p, kind], i) => [p, types[i], kind]) };
}
const K = {
  scheduled: manager.getEvent('OperationScheduled').topicHash,
  cancel: manager.getFunction('cancel').selector,
  getSchedule: manager.getFunction('getSchedule').selector,
};

const BNB_ADD = { chainName: 'BNB Smart Chain', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.bnbchain.org'], blockExplorerUrls: ['https://bscscan.com'] };
const networks = [
  // Tenderly's public gateway keeps old logs and receipts; publicnode's free Ethereum node only the last ~10 000 blocks.
  { key: 'eth', name: 'Ethereum', chainId: 1, manager: null, vault: null, fromBlock: 0, decimals: 6, token: 'USDT', explorer: 'https://etherscan.io', chunk: 10000,
    rpcs: ['https://mainnet.gateway.tenderly.co', 'https://rpc.flashbots.net', 'https://rpc.mevblocker.io', 'https://ethereum-rpc.publicnode.com'], add: null },
  { key: 'bsc', name: 'BNB Chain', chainId: 56, manager: null, vault: null, fromBlock: 0, decimals: 18, token: 'BSC-USD', explorer: 'https://bscscan.com', chunk: 50000,
    rpcs: ['https://bsc-rpc.publicnode.com'], add: BNB_ADD },
];
const deploymentPath = process.argv[2];
if (deploymentPath) {
  const dep = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  for (const n of networks) {
    const c = dep.chains.find((x) => x.chainId === n.chainId);
    if (!c?.accessManager || !c.vault) throw new Error(`${deploymentPath}: no vault and accessManager for chain ${n.chainId}`);
    Object.assign(n, { manager: ethers.getAddress(c.accessManager), vault: ethers.getAddress(c.vault), fromBlock: c.fromBlock ?? 0, decimals: c.decimals ?? n.decimals, explorer: c.explorer ?? n.explorer });
  }
}

const CONFIG = {
  mainnet: { label: 'Ethereum · BNB Chain', canceller: CANCELLER, safe: SAFE, monitors: ['https://monitor.kaspa.news'], networks },
  practice: {
    label: 'Sepolia practice · test coins only', canceller: CANCELLER, safe: '0xc4747f7Bc83d0625c3a7793571B0883Cc320c07d', monitors: [],
    networks: [{ key: 'sepolia', name: 'Sepolia', chainId: 11155111, manager: '0xAEF4DF55837B284b9c0e0E7AA87C1cda43fA81f0', vault: '0x03d2c68bceca335253376988c2f1fa318ff4375d',
      fromBlock: 12083000, decimals: 6, token: 'test USDT', explorer: 'https://sepolia.etherscan.io', chunk: 5000,
      rpcs: ['https://sepolia.gateway.tenderly.co', 'https://ethereum-sepolia-rpc.publicnode.com'],
      add: { chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] } }],
  },
};

const here = new URL('.', import.meta.url).pathname;
let html = fs.readFileSync(here + 'page.html', 'utf8');
for (const [mark, value] of [['/*CONFIG*/null', CONFIG], ['/*CALLS*/null', CALLS], ['/*CONST*/null', K]]) {
  if (!html.includes(mark)) throw new Error(`page.html has no ${mark}`);
  html = html.replace(mark, () => JSON.stringify(value));
}
fs.writeFileSync(here + 'index.html', html);
console.log(`index.html: ${Object.keys(CALLS).length} owner calls; mainnet managers: ${networks.map((n) => `${n.name} ${n.manager ?? 'not yet'}`).join(', ')}`);
