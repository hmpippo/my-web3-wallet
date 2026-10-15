# MVP Non-Custodial HD Wallet - Technical Design Document (AGENTS.md)

> **目标**：指导 Code Agent 独立完成一个可运行的、安全的、纯客户端 MVP 非托管钱包。  
> **原则**：简单、安全第一、最小功能集、可测试、可扩展。

---

## 1. 产品目标与范围

### 1.1 产品定位
一个**纯客户端、非托管、基于 HD Wallet 的 EVM 钱包 MVP**。  
用户完全控制私钥，应用永不接触完整私钥明文（除内存中短暂使用）。

### 1.2 MVP 功能清单（必须实现）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 创建新钱包 | P0 | 生成 BIP-39 助记词 + 设置密码加密存储 |
| 导入钱包 | P0 | 通过 12/24 词助记词导入 |
| 解锁钱包 | P0 | 密码解锁，加载加密的 vault |
| 显示账户地址 + 余额 | P0 | 支持原生 ETH + 简单 ERC-20（可选） |
| 发送交易 | P0 | 原生代币转账 |
| 交易历史 | P1 | 通过 RPC 或 explorer API 拉取 |
| 助记词备份确认 | P0 | 强制用户确认已备份 |
| 锁定钱包 | P0 | 清除内存中的私钥 |

### 1.3 明确不在 MVP 范围（Non-Goals）
- 多链支持（只做一条 EVM 链，推荐 Sepolia 测试网）
- Swap / Bridge / NFT 展示
- WalletConnect / dApp 浏览器
- MPC / Account Abstraction / Social Login
- 后端服务、用户账户系统、推送通知
- 硬件钱包支持
- 复杂 gas 估算 UI（用简单估算即可）

---

## 2. 总体架构

### 2.1 架构风格
**纯客户端三层架构**（无后端）：

```
┌─────────────────────────────────────────────┐
│                  UI Layer                   │
│  (React / Next.js 或 React Native)          │
│  - Screens / Components                     │
│  - 只负责展示与用户交互                     │
└────────────────────┬────────────────────────┘
                     │ 调用
┌────────────────────▼────────────────────────┐
│               Service Layer                 │
│  - WalletService                            │
│  - TransactionService                       │
│  - BalanceService                           │
│  - StorageService                           │
└────────────────────┬────────────────────────┘
                     │ 使用
┌────────────────────▼────────────────────────┐
│                Core Layer                   │
│  - HD Wallet (BIP-39/32/44)                 │
│  - Crypto (加密/解密 vault)                 │
│  - Chain Adapter (viem)                     │
└─────────────────────────────────────────────┘
```

### 2.2 关键设计原则
1. **私钥永不离开设备，且只在内存中短暂存在**。
2. **所有敏感操作必须在 Core 层完成**。
3. **UI 层绝对不能直接接触私钥或助记词明文**（除创建/导入时的临时输入）。
4. **使用经过审计的库**，禁止自己实现加密或密钥派生。
5. **状态最小化**：钱包解锁状态、当前账户、余额缓存。

---

## 3. 技术栈（强制使用）

| 类别 | 技术 | 版本建议 | 备注 |
|------|------|----------|------|
| 语言 | TypeScript | 5.x | 严格模式 |
| 框架 | Next.js (App Router) 或 React + Vite | 最新稳定 | Web 优先，最易做 MVP |
| 区块链 | `viem` | 最新 | 推荐，类型安全 |
| HD Wallet | `@scure/bip39` + `@scure/bip32` | 最新 | 轻量、审计过 |
| 加密 | Web Crypto API (AES-GCM + PBKDF2) | 原生 | 禁止自己实现 |
| 状态管理 | Zustand 或 React Context + useReducer | - | 轻量 |
| UI | Tailwind CSS + 简单组件 | - | 快速 |
| 测试 | Vitest | - | 单元测试优先 |

**禁止使用**：ethers.js v5、web3.js、自己写的加密算法。

---

## 4. 模块详细设计

### 4.1 Core - HD Wallet Module (`src/core/hd-wallet.ts`)

**职责**：
- 生成助记词
- 从助记词派生账户
- 根据派生路径生成私钥 / 地址

**关键接口**：

```typescript
interface DerivedAccount {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  publicKey: `0x${string}`;
}

interface HDWallet {
  generateMnemonic(strength?: 128 | 256): string; // 12 or 24 words
  validateMnemonic(mnemonic: string): boolean;
  mnemonicToSeed(mnemonic: string, passphrase?: string): Promise<Uint8Array>;
  deriveAccount(seed: Uint8Array, path?: string): DerivedAccount;
}

// 默认派生路径（Ethereum / EVM）
const DEFAULT_PATH = "m/44'/60'/0'/0/0";
```

**实现要求**：
- 使用 `@scure/bip39` 生成和验证助记词
- 使用 `@scure/bip32` 进行派生
- 所有函数必须是纯函数，无副作用
- 私钥返回后调用方必须尽快使用并清除

### 4.2 Core - Crypto Module (`src/core/crypto.ts`)

**职责**：加密 / 解密 Vault（助记词）

**Vault 结构**（加密后存储）：

```typescript
interface EncryptedVault {
  version: 1;
  salt: string;          // base64
  iv: string;            // base64
  ciphertext: string;    // base64
}
```

**关键接口**：

```typescript
async function encryptVault(
  data: string,          // 助记词明文
  password: string
): Promise<EncryptedVault>;

async function decryptVault(
  vault: EncryptedVault,
  password: string
): Promise<string>;      // 返回助记词明文
```

**实现要求**：
- 使用 Web Crypto API：`PBKDF2`（建议 600_000 次迭代）+ `AES-GCM`
- 密码错误必须抛出明确错误
- 绝不在日志中打印任何敏感数据

### 4.3 Storage Module (`src/core/storage.ts`)

**职责**：本地持久化加密 Vault

**接口**：

```typescript
interface StorageService {
  saveVault(vault: EncryptedVault): Promise<void>;
  loadVault(): Promise<EncryptedVault | null>;
  clearVault(): Promise<void>;
  hasVault(): Promise<boolean>;
}
```

**实现**：
- Web 端使用 `localStorage` 或 `indexedDB`（推荐 indexedDB）
- Key 名固定为：`wallet_vault_v1`

### 4.4 Wallet Service (`src/services/wallet-service.ts`)

**职责**：钱包生命周期管理（创建、导入、解锁、锁定、签名）

**状态**（推荐用 Zustand）：

```typescript
interface WalletState {
  isUnlocked: boolean;
  address: `0x${string}` | null;
  // 注意：私钥只存在内存中，绝不放入持久化 state
}
```

**关键方法**：

```typescript
class WalletService {
  async createWallet(password: string): Promise<{
    mnemonic: string;
    address: `0x${string}`;
  }>;

  async importWallet(
    mnemonic: string,
    password: string
  ): Promise<`0x${string}`>;

  async unlock(password: string): Promise<void>;

  lock(): void; // 立即清除内存中的私钥

  getAddress(): `0x${string}` | null;

  // 仅在解锁状态下可用
  async signAndSendTransaction(
    tx: {
      to: `0x${string}`;
      value: bigint;
    }
  ): Promise<`0x${string}`>; // 返回 tx hash
}
```

**流程要求**：
1. 创建时：生成助记词 → 强制用户确认备份 → 加密存储 → 派生第一个账户
2. 解锁时：解密 vault → 派生私钥 → 放入内存
3. 锁定或页面刷新：立即清除私钥

### 4.5 Transaction Service (`src/services/transaction-service.ts`)

**职责**：构建、签名、发送交易

**关键方法**：

```typescript
async function sendNativeTransfer(params: {
  to: `0x${string}`;
  value: bigint;          // wei
  privateKey: `0x${string}`;
}): Promise<`0x${string}`>; // tx hash
```

**要求**：
- 使用 `viem` 的 `createWalletClient` + `privateKeyToAccount`
- 简单 gas 估算（`estimateGas` + `getGasPrice`）
- 返回交易哈希

### 4.6 Balance Service (`src/services/balance-service.ts`)

```typescript
async function getNativeBalance(address: `0x${string}`): Promise<bigint>;
async function getTransactionHistory(address: `0x${string}`): Promise<any[]>; // 简单实现即可
```

### 4.7 Chain Adapter (`src/core/chain.ts`)

```typescript
export const CHAIN = {
  id: 11155111, // Sepolia
  name: "Sepolia",
  rpcUrls: {
    default: { http: ["https://ethereum-sepolia-rpc.publicnode.com"] },
  },
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
  },
} as const;
```

使用 `viem` 的 `createPublicClient` 和 `http` transport。

---

## 5. 数据流与关键用户流程

### 5.1 创建钱包流程
1. 用户点击「创建钱包」
2. 生成助记词并展示（可复制）
3. 用户必须勾选「我已安全备份」并设置密码
4. 加密 vault 并保存到本地
5. 派生地址 → 进入主界面

### 5.2 发送交易流程
1. 用户输入收款地址 + 金额
2. 显示预估 gas + 总费用
3. 用户确认 → 使用内存中的私钥签名并广播
4. 显示交易哈希和浏览器链接

### 5.3 安全关键点
- 助记词只在创建/导入时短暂出现在 UI
- 私钥只在 `WalletService` 内存中存在
- 任何错误都不能把私钥写到 console 或错误上报

---

## 6. 推荐目录结构

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 入口（创建 / 导入 / 解锁）
│   ├── wallet/
│   │   └── page.tsx              # 主界面（余额 + 地址）
│   └── send/
│       └── page.tsx              # 发送页面
├── components/
│   ├── CreateWallet.tsx
│   ├── ImportWallet.tsx
│   ├── UnlockWallet.tsx
│   ├── BalanceCard.tsx
│   ├── AddressDisplay.tsx
│   └── SendForm.tsx
├── core/
│   ├── hd-wallet.ts
│   ├── crypto.ts
│   ├── storage.ts
│   └── chain.ts
├── services/
│   ├── wallet-service.ts
│   ├── transaction-service.ts
│   └── balance-service.ts
├── store/
│   └── wallet-store.ts           # Zustand
├── types/
│   └── index.ts
└── lib/
    └── utils.ts
```

---

## 7. 实现顺序建议（给 Code Agent 的任务拆分）

1. **先完成 Core 层并写单元测试**
   - `hd-wallet.ts`（生成助记词、派生地址）
   - `crypto.ts`（加密解密 round-trip）
   - `storage.ts`

2. **实现 WalletService**
   - 创建 → 加密存储 → 解锁 → 锁定 全流程打通

3. **实现 Chain + Transaction**
   - 使用测试网完成真实发送交易

4. **实现 UI 页面**
   - 创建 / 导入 / 解锁 / 主界面 / 发送页面

5. **打磨与安全检查**
   - 错误处理、Loading 状态、助记词确认步骤、基本样式
   - 确认没有敏感信息泄漏到 console

---

## 8. 测试要求

### 单元测试必须覆盖：
- 助记词生成与验证
- 固定种子能派生出固定地址（确定性测试）
- 加密 → 解密 round-trip 成功
- 错误密码解密必须失败

### 手动测试清单：
- 创建钱包 → 备份助记词 → 锁定 → 解锁 → 发送测试币成功
- 使用同一助记词导入能得到完全相同的地址
- 刷新页面后必须重新输入密码才能解锁
- 错误密码无法解锁

---

## 9. 安全 Checklist（必须全部满足）

- [ ] 使用 `@scure/bip39`、`@scure/bip32` 和 Web Crypto API
- [ ] 私钥 / 助记词绝不写入 localStorage 明文
- [ ] 创建时强制用户确认已备份助记词
- [ ] 密码建议至少 8 位
- [ ] 所有异步操作有明确错误处理
- [ ] 生产环境关闭所有可能打印敏感信息的日志
- [ ] 锁定或页面卸载时立即清除内存中的私钥

---

## 10. 后续可扩展方向（现在不要实现）

- 多账户支持（同一助记词派生多个 account）
- ERC-20 代币发送
- 多链切换
- WalletConnect
- 更详细的 gas 估算与交易模拟
- 移动端适配（React Native）

---

## 11. 运行时验证（重要）

**After every edit, verify the page still works at runtime using the next-dev-loop skill.**

不要假设“改完代码 = 页面正常”。每次修改组件或样式后，必须通过 `next-dev-loop` Skill 验证页面在浏览器中的实际渲染效果。该 Skill 会同时检查框架侧（编译错误、路由）和浏览器侧（控制台、DOM、网络请求），确保改动没有破坏运行时表现。

**文档结束**

Code Agent 请严格按照以上模块边界、接口定义和实现顺序进行开发。  
任何偏离「纯客户端 + 非托管 + 最小功能集」的决定，必须先说明理由。
