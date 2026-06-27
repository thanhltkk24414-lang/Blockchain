# Fapex

**FAPEX** — nền tảng freelance Web3 với escrow on-chain, IPFS, SIWE, và tranh chấp qua arbitrator có stake.

## Monorepo

| Thư mục | Repo | Mô tả |
|---------|------|--------|
| [`contracts/`](contracts/) | blockchain-contracts | Solidity + Hardhat tại root |
| [`backend/`](backend/) | blockchain-backend | Node API, indexer, Pinata IPFS |
| [`frontend/`](frontend/) | blockchain-frontend | Vite + React + wagmi (canonical) |
| [`docs/`](docs/) | Blockchain-docs | Hướng dẫn, báo cáo, audit |

## Chạy nhanh (local)

```bash
# Contracts
npm install
npm run compile          # auto export ABIs → backend + frontend

# Backend
cd backend && npm install && cp .env.example .env && npm run dev

# Frontend
cd frontend && npm install && cp .env.example .env && npm run dev
```

- Frontend: http://localhost:3000  
- Backend: http://127.0.0.1:5000 (`/health`, `/api/config`, `/siwe-sign.html`)

## Sepolia

Địa chỉ deploy: `deployments/sepolia.json`. Demo dispute dùng `DisputeTimings.demo.sol` (cửa sổ phút).

```bash
npm run deploy:sepolia
npm run seed:arbitrators
```

## Tài liệu

- [Ma trận audit issue (VI)](docs/guides/issue-audit-status-vi.md)
- [Luồng E2E (VI)](docs/guides/workflow-e2e-vi.md)
- [Thiết kế hệ thống (VI)](docs/guides/system-design-vi.md)
- [Chainlink integration](docs/guides/chainlink-integration-vi.md)
- [Demo script (VI)](docs/guides/demo-script-vi.md)

## Production

- API: https://fapex-backend-production.up.railway.app  
- Frontend: Vercel (`frontend/`, `npm run build`)
