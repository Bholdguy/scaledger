import 'dotenv/config';
import { createApp } from './app.js';
import { getDb } from './db.js';
import { seedIssuerDisclosures } from './issuerDisclosureService.js';

const port = Number(process.env.PORT ?? 8787);
getDb();
seedIssuerDisclosures();
createApp().listen(port, () => {
  console.log(`Scaledger API listening on :${port}`);
});
