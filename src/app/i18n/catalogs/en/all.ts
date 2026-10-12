// One module per language so the browser fetches a SINGLE lazy chunk for all
// namespaces (instead of one request per namespace). Add a namespace here AND
// create <ns>.json in en/, ar/ and meta/. Keep the list alphabetical.
import ai from './ai.json';
import aimode from './aimode.json';
import campaigns from './campaigns.json';
import captions from './captions.json';
import catalog from './catalog.json';
import common from './common.json';
import customers from './customers.json';
import embedded from './embedded.json';
import errors from './errors.json';
import flowlang from './flowlang.json';
import flows from './flows.json';
import hub from './hub.json';
import inbox from './inbox.json';
import preview from './preview.json';
import promolang from './promolang.json';
import review from './review.json';
import settings from './settings.json';
import status from './status.json';
import templates from './templates.json';

const catalogue: Record<string, Record<string, string>> = {
  ai,
  aimode,
  campaigns,
  captions,
  catalog,
  common,
  customers,
  embedded,
  errors,
  flowlang,
  flows,
  hub,
  inbox,
  preview,
  promolang,
  review,
  settings,
  status,
  templates,
};

export default catalogue;
