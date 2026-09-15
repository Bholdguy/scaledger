import express from 'express';
import cors from 'cors';
import { getHoldingsForWallet } from './holdingsService.js';
import { parsePublicKeyStrict, InvalidPublicKeyError, getConnection } from './solana.js';
import { RpcRateLimitError } from './rpcRetry.js';
import { getDb } from './db.js';
import { isAllowlistedMint } from '../shared/allowlist.js';
import { SolanaRpcSource, FixtureSource, type DataSource } from './dataSource.js';
import { runVerificationPipeline } from './verificationPipeline.js';
import { getVerificationForMint } from './verificationService.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function dataSourceFor(mode: string | undefined): DataSource {
  if (mode === 'demo') {
    return new FixtureSource(path.join(__dirname, '../../fixtures/strcx-canonical-event.json'));
  }
  return new SolanaRpcSource(getConnection());
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/holdings', async (req, res) => {
    const wallet = req.query.wallet;
    if (typeof wallet !== 'string') {
      res.status(400).json({ error: 'missing wallet query parameter' });
      return;
    }
    try {
      parsePublicKeyStrict(wallet);
    } catch (err) {
      if (err instanceof InvalidPublicKeyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    try {
      const holdings = await getHoldingsForWallet(wallet);
      res.json({ wallet, holdings });
    } catch (err) {
      if (err instanceof RpcRateLimitError) {
        res.status(503).json({ error: 'could not complete holdings lookup — RPC rate limited, retry later' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  app.post('/api/verification/run', async (req, res) => {
    const mint = req.query.mint;
    if (typeof mint !== 'string' || !isAllowlistedMint(mint)) {
      res.status(400).json({ error: 'missing or unrecognized mint query parameter' });
      return;
    }
    try {
      const dataSource = dataSourceFor(typeof req.query.mode === 'string' ? req.query.mode : process.env.APP_MODE);
      const records = await runVerificationPipeline(dataSource, mint);
      res.json({ mint, records });
    } catch (err) {
      if (err instanceof RpcRateLimitError) {
        res.status(503).json({ error: 'could not complete rebase scan — RPC rate limited, retry later' });
        return;
      }
      console.error(err);
      res.status(500).json({ error: 'internal error' });
    }
  });

  app.get('/api/verification', (req, res) => {
    const mint = req.query.mint;
    if (typeof mint !== 'string') {
      res.status(400).json({ error: 'missing mint query parameter' });
      return;
    }
    const record = getVerificationForMint(mint);
    if (!record) {
      res.status(404).json({ error: 'no verification record for this mint yet' });
      return;
    }
    res.json(record);
  });

  app.get('/api/holdings/:wallet/:mint/impact', (req, res) => {
    const { wallet, mint } = req.params;
    try {
      parsePublicKeyStrict(wallet);
    } catch (err) {
      if (err instanceof InvalidPublicKeyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    const record = getVerificationForMint(mint);
    if (!record) {
      res.status(404).json({ error: 'no verification record for this mint yet' });
      return;
    }

    const db = getDb();
    const holding = db
      .prepare(`SELECT balance FROM Holdings WHERE wallet = ? AND mint = ?`)
      .get(wallet, mint) as { balance: number } | undefined;
    if (!holding) {
      res.status(404).json({ error: 'wallet does not hold this mint (or holdings were never fetched)' });
      return;
    }

    const personalExpectedChange =
      record.expectedRatio === null ? null : holding.balance * (record.expectedRatio / 100);
    const personalActualChange = holding.balance * (record.actualRatio / 100);

    res.json({
      wallet,
      mint,
      verificationRecordId: record.id,
      status: record.status,
      balance: holding.balance,
      derived: true,
      personalExpectedChange,
      personalActualChange,
    });
  });

  app.get('/api/verification/history', (req, res) => {
    const wallet = req.query.wallet;
    if (typeof wallet !== 'string') {
      res.status(400).json({ error: 'missing wallet query parameter' });
      return;
    }
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT vr.*, re.mint, re.effective_timestamp FROM VerificationRecords vr
         JOIN RebaseEvents re ON re.id = vr.rebase_event_id
         JOIN Holdings h ON h.mint = re.mint
         WHERE h.wallet = ?
         ORDER BY re.effective_timestamp DESC`,
      )
      .all(wallet);
    res.json({ wallet, history: rows });
  });

  app.get('/api/verification/:id/export', (req, res) => {
    const { id } = req.params;
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const db = getDb();
    const row = db
      .prepare(
        `SELECT vr.*, re.mint, re.tx_signature, re.old_multiplier, re.new_multiplier, re.effective_timestamp,
                car.ticker, car.size AS dividend_size, car.prior_close_price, car.source, car.source_mode, car.source_url
         FROM VerificationRecords vr
         JOIN RebaseEvents re ON re.id = vr.rebase_event_id
         LEFT JOIN CorporateActionReferences car ON car.id = vr.corporate_action_reference_id
         WHERE vr.id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ error: 'no such verification record' });
      return;
    }
    if (format === 'json') {
      res.json(row);
      return;
    }
    const headers = Object.keys(row);
    const values = headers.map((h) => String(row[h] ?? ''));
    res.setHeader('Content-Type', 'text/csv');
    res.send(`${headers.join(',')}\n${values.join(',')}\n`);
  });

  // Production: the marketing landing page owns "/"; the functional dashboard (wallet
  // connect, verification pipeline, ledger, export) lives at "/app". Both are served from
  // this same service/origin as the API — no separate dev proxy needed once built (see
  // vite.config.ts for the dev-only proxy and its matching `base: '/app/'`).
  const landingDir = path.join(__dirname, '../../landing');
  if (existsSync(landingDir)) {
    app.use(express.static(landingDir));
    app.get('/', (_req, res) => {
      res.sendFile(path.join(landingDir, 'index.html'));
    });
  }

  // Only mounted when a build actually exists, so `npm run dev:server` alone (the
  // dashboard served by Vite instead, at :5173/app/) doesn't 404 on every /app/* request.
  const distDir = path.join(__dirname, '../../dist');
  if (existsSync(distDir)) {
    app.use('/app', express.static(distDir));
    app.get(/^\/app(\/.*)?$/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}
