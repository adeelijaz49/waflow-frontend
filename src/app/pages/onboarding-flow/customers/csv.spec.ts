import {
  MAX_IMPORT_ROWS, NOTES_OPT_IN_PREFIX, blobToText, buildCustomerTemplateCsv, buildJobCsv, decodeCsvBytes,
  detectDelimiter, fileKind, isYes, mergeErrorReports, notesFor, parseCsvDetailed, parseCsvText, parseCustomerFileText, parseCustomerTable,
  parsePasteText, splitByOptIn, stripBom, toCsv,
  type CustomerRow, type OptIn, type RejectedRow,
} from './csv';

const BOM = String.fromCodePoint(0xfeff);
const ar = (...cps: number[]): string => String.fromCodePoint(...cps);
// "الاسم" (the name) and a short Arabic customer name, built from code points
const ALISM = ar(0x627, 0x644, 0x627, 0x633, 0x645);
const ALJAWWAL = ar(0x627, 0x644, 0x62c, 0x648, 0x627, 0x644);
const NAAM = ar(0x646, 0x639, 0x645);
const FATIMA = ar(0x641, 0x627, 0x637, 0x645, 0x629);
const ARABIC_INDIC_PHONE = ar(0x660, 0x665, 0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667);

/** A valid 10-digit local number per index (the generated lists of the 5,000 row cap must not trip the phone check). */
const tenDigits = (i: number): string => `0500${String(i).padStart(6, '0')}`;

const row = (over: Partial<CustomerRow> = {}): CustomerRow => ({
  name: 'Sara Ahmed', phone: '+966501234567', digits: '966501234567', email: '', notes: '', language: '', optIn: 'unset', source: '', date: '', ...over,
});
/** A row for the split specs: the number is derived from a short id. */
const person = (id: string, optIn: OptIn, over: Partial<CustomerRow> = {}): CustomerRow => {
  const digits = `9665${id.padStart(8, '0')}`;
  return row({ name: id, phone: `+${digits}`, digits, optIn, ...over });
};
const rej = (over: Partial<RejectedRow> = {}): RejectedRow => ({ name: '', phone: '', email: '', notes: '', language: '', reason: 'invalid_phone', ...over });

describe('parseCsvText / parseCsvDetailed', () => {
  it('reads a plain comma file with LF line ends', () => {
    expect(parseCsvText('Name,Phone\nSara,0501\nOmar,0502\n')).toEqual([['Name', 'Phone'], ['Sara', '0501'], ['Omar', '0502']]);
  });

  it('handles CRLF and lone CR line ends', () => {
    expect(parseCsvText('a,b\r\nc,d\r\ne,f')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
    expect(parseCsvText('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips a BOM', () => {
    expect(stripBom(`${BOM}x`)).toBe('x');
    expect(parseCsvText(`${BOM}Name,Phone\nSara,1`)[0]).toEqual(['Name', 'Phone']);
  });

  it('auto-detects the semicolon delimiter', () => {
    expect(detectDelimiter('Name;Phone\nSara;1')).toBe(';');
    expect(parseCsvText('Name;Phone\nSara;0501')).toEqual([['Name', 'Phone'], ['Sara', '0501']]);
  });

  it('auto-detects the tab delimiter', () => {
    const tab = String.fromCharCode(9);
    expect(detectDelimiter(`Name${tab}Phone\nSara${tab}1`)).toBe(tab);
    expect(parseCsvText(`Name${tab}Phone\nSara${tab}0501`)).toEqual([['Name', 'Phone'], ['Sara', '0501']]);
  });

  it('defaults to comma for an empty or delimiter-less text', () => {
    expect(detectDelimiter('')).toBe(',');
    expect(detectDelimiter('just one column')).toBe(',');
  });

  it('ignores delimiters inside quotes when detecting', () => {
    expect(detectDelimiter('"a;b;c;d",e,f\n1,2,3')).toBe(',');
  });

  it('handles quotes: embedded delimiter, doubled quote, embedded newline', () => {
    const text = 'Name,Notes\n"Ahmed, Sara","said ""hi"""\n"Two\nLines",x';
    expect(parseCsvText(text)).toEqual([['Name', 'Notes'], ['Ahmed, Sara', 'said "hi"'], ['Two\nLines', 'x']]);
  });

  it('keeps a quote in the middle of a cell literally', () => {
    expect(parseCsvText('5" pipe,x')).toEqual([['5" pipe', 'x']]);
  });

  it('drops blank lines but keeps blank cells', () => {
    expect(parseCsvText('a,b\n\n,\n\nc,d\n')).toEqual([['a', 'b'], ['', ''], ['c', 'd']]);
  });

  it('keeps Arabic text and Arabic-Indic digits untouched', () => {
    const t = parseCsvText(`${ALISM},${ALJAWWAL}\n${FATIMA},${ARABIC_INDIC_PHONE}`);
    expect(t[1]).toEqual([FATIMA, ARABIC_INDIC_PHONE]);
  });

  it('accepts a space before a quote (`, "a, b"`): the columns do not shift', () => {
    expect(parseCsvText('Name,Notes,Phone\nSara, "a, b", 0501234567')).toEqual([['Name', 'Notes', 'Phone'], ['Sara', 'a, b', ' 0501234567']]);
    expect(parseCsvText('  "Ahmed, Sara",x')).toEqual([['Ahmed, Sara', 'x']]);
    expect(parseCsvText('Name;Phone\n "Ali; Jr";0501')).toEqual([['Name', 'Phone'], ['Ali; Jr', '0501']]);
  });

  describe('a quote that is never closed does not swallow the rest of the file (R6-12)', () => {
    it('the line that holds it is reported, the lines after it are read as usual', () => {
      const r = parseCsvDetailed('Name,Phone\n"Sara,0501234567\nOmar,0502345678\nLina,0503456789\n');
      expect(r.unreadable).toEqual(['"Sara,0501234567']);
      expect(r.rows).toEqual([['Name', 'Phone'], ['Omar', '0502345678'], ['Lina', '0503456789']]);
    });

    it('also when the quote opens in the middle of a row', () => {
      const r = parseCsvDetailed('Name,Phone\nSara,"0501234567\nOmar,0502345678\n');
      expect(r.unreadable).toEqual(['Sara,"0501234567']);
      expect(r.rows).toEqual([['Name', 'Phone'], ['Omar', '0502345678']]);
    });

    it('two stray quotes that pair up merge lines into one cell: the row is unreadable (counted by line), never a customer', () => {
      const p = parseCustomerFileText('Name,Phone\nSara,"0501234567\nOmar,0502345678\n"Lina,0503456789\nNour,0504567890');
      expect(p.rows.map((r) => r.name)).toEqual(['Nour']);
      expect(p.rejected.map((r) => r.reason)).toEqual(['unreadable']);
      expect(p.rejected[0].name).not.toMatch(/[\r\n]/);
      expect(p.unreadable).toBe(3);
    });

    it('a stray quote followed by a real quoted cell later is not read as a clean customer either', () => {
      const p = parseCustomerFileText('Name,Phone\n"Sara,0501234567\nOmar,0502345678\n"Lina, Nasser",0503456789\n');
      expect(p.rows).toEqual([]);
      expect(p.rejected.map((r) => r.reason)).toEqual(['unreadable']);
      expect(p.unreadable).toBe(3);
    });

    it('a 500-row file with one stray quote loses ONE line, not ~495', () => {
      const lines = ['Name,Phone'];
      for (let i = 0; i < 500; i++) lines.push(i === 3 ? `"Broken,${tenDigits(i)}` : `C${i},${tenDigits(i)}`);
      const r = parseCsvDetailed(lines.join('\n'));
      expect(r.unreadable).toHaveLength(1);
      expect(r.rows).toHaveLength(500); // header + 499 customers
    });

    it('a text that ends right after the opening quote, and a quote only, are one unreadable line each', () => {
      expect(parseCsvDetailed('a,b\n"').unreadable).toEqual(['"']);
      expect(parseCsvDetailed('"').unreadable).toEqual(['"']);
      expect(parseCsvDetailed('"').rows).toEqual([]);
    });

    it('keeps a legitimately closed quoted cell with line breaks (not an error)', () => {
      const r = parseCsvDetailed('Name,Notes\nSara,"line one\nline two"\nOmar,x');
      expect(r.unreadable).toEqual([]);
      expect(r.rows[1]).toEqual(['Sara', 'line one\nline two']);
    });

    it('a large file with a stray quote near the top is read in bounded time', () => {
      const lines = ['Name,Phone', '"Broken,0500000000'];
      for (let i = 1; i < 5000; i++) lines.push(`C${i},${tenDigits(i)}`);
      const started = Date.now();
      const r = parseCsvDetailed(lines.join('\n'));
      expect(Date.now() - started).toBeLessThan(5000);
      expect(r.unreadable).toHaveLength(1);
      expect(r.rows).toHaveLength(5000);
    });
  });
});

describe('decodeCsvBytes', () => {
  const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

  it('decodes UTF-8 with and without a BOM', () => {
    expect(decodeCsvBytes(enc(`${BOM}Name,${FATIMA}`))).toBe(`Name,${FATIMA}`);
    expect(decodeCsvBytes(enc(`Name,${FATIMA}`))).toBe(`Name,${FATIMA}`);
  });

  it('accepts an ArrayBuffer', () => {
    const bytes = enc('abc');
    expect(decodeCsvBytes(bytes.buffer.slice(0) as ArrayBuffer)).toBe('abc');
  });

  it('falls back to Windows-1256 for an Arabic Excel CSV', () => {
    // "الاسم" in windows-1256
    const bytes = new Uint8Array([0xc7, 0xe1, 0xc7, 0xd3, 0xe3, 0x2c, 0x50]);
    expect(decodeCsvBytes(bytes)).toBe(`${ALISM},P`);
  });

  it('decodes UTF-16 with a BOM', () => {
    const units = [0xfeff, ...'Name'.split('').map((c) => c.charCodeAt(0))];
    const bytes = new Uint8Array(units.length * 2);
    units.forEach((u, i) => {
      bytes[i * 2] = u & 0xff;
      bytes[i * 2 + 1] = u >> 8;
    });
    expect(decodeCsvBytes(bytes)).toBe('Name');
  });
});

describe('fileKind', () => {
  it.each<[string, string, string]>([
    ['list.csv', '', 'csv'], ['LIST.CSV', '', 'csv'], ['list.txt', '', 'csv'], ['list.xlsx', '', 'xlsx'], ['list.xls', '', 'xlsx'],
    ['list.pdf', '', 'other'], ['list', 'text/csv', 'csv'], ['list', '', 'other'], ['a.csv.exe', '', 'other'],
  ])('%s (%s) -> %s', (name, mime, kind) => {
    expect(fileKind(name, mime)).toBe(kind);
  });
});

describe('isYes', () => {
  it.each(['yes', 'YES', ' y ', 'true', '1', 'opted in', 'Agreed', NAAM, ar(0x645, 0x648, 0x627, 0x641, 0x642), ar(0x661)])('%s is a yes', (v) => {
    expect(isYes(v)).toBe(true);
  });
  it.each(['no', 'n', '', '0', 'false', 'maybe', 'unknown', 'not sure', 'Yes.', 'yes!', 'yes (verbal)', 'unsubscribed', undefined, null])('%s is not a yes', (v) => {
    expect(isYes(v)).toBe(false);
  });
});

describe('parseCustomerTable: columns and rows', () => {
  it('maps Name / Phone / Email / Notes and flags no opt-in column; every row says nothing about consent (unset)', () => {
    const p = parseCustomerTable([['Name', 'Phone', 'Email', 'Notes'], ['Sara', '0501234567', 'a@b.co', 'vip']]);
    expect(p.issue).toBeNull();
    expect(p.hasOptInColumn).toBe(false);
    expect(p.rows).toEqual([row({ name: 'Sara', email: 'a@b.co', notes: 'vip' })]);
    expect(p.unreadable).toBe(0);
    expect(p.unknownConsentColumns).toEqual([]);
    expect(p.optOutColumns).toEqual([]);
  });

  it('matches the engine aliases case- and space-insensitively', () => {
    const p = parseCustomerTable([['  FULL NAME ', 'Mobile Number'], ['Sara', '0501234567']]);
    expect(p.rows[0].name).toBe('Sara');
    expect(p.rows[0].digits).toBe('966501234567');
    expect(parseCustomerTable([['customer name', 'WhatsApp'], ['A', '0501234567']]).rows).toHaveLength(1);
  });

  it('matches Arabic headers', () => {
    const p = parseCustomerTable([[ALISM, ALJAWWAL, ar(0x627, 0x644, 0x645, 0x648, 0x627, 0x641, 0x642, 0x629)], [FATIMA, '0501234567', NAAM]]);
    expect(p.issue).toBeNull();
    expect(p.rows[0]).toMatchObject({ name: FATIMA, optIn: 'yes' });
    expect(p.hasOptInColumn).toBe(true);
  });

  it('joins first and last name columns when there is no single name column', () => {
    const p = parseCustomerTable([['First name', 'Last name', 'Phone'], ['Sara', 'Ahmed', '0501234567'], ['Omar', '', '0502345678']]);
    expect(p.rows.map((r) => r.name)).toEqual(['Sara Ahmed', 'Omar']);
  });

  it('keeps the language column (the caller decides whether Arabic is on); only a language the server understands survives', () => {
    const p = parseCustomerTable([['Name', 'Phone', 'Language (en/ar)'], ['Sara', '0501234567', 'ar'], ['Omar', '0502345678', 'English'], ['Lina', '0503456789', 'klingon'], ['Nour', '0504567890', '']]);
    expect(p.hasLanguageColumn).toBe(true);
    expect(p.rows.map((r) => r.language)).toEqual(['ar', 'en', '', '']);
  });

  it('an unusable e-mail is dropped, the customer still imports (R6-07)', () => {
    const p = parseCustomerTable([['Name', 'Phone', 'Email'], ['Sara', '0501234567', 'n/a'], ['Omar', '0502345678', '-'], ['Lina', '0503456789', 'lina@x.co'], ['Nour', '0504567890', 'a b@x.co']]);
    expect(p.rows.map((r) => r.email)).toEqual(['', '', 'lina@x.co', '']);
    expect(p.rows).toHaveLength(4);
    expect(p.rejected).toHaveLength(0);
  });

  it('puts rows without a name or a phone into the rejected list with a reason', () => {
    const p = parseCustomerTable([['Name', 'Phone'], ['', '0501234567'], ['Omar', ''], ['Sara', '0502345678']]);
    expect(p.rows).toHaveLength(1);
    expect(p.rejected.map((r) => r.reason)).toEqual(['missing_name', 'missing_phone']);
    expect(p.rejected[0].phone).toBe('0501234567');
  });

  it('a missing name or a missing phone keeps its own reason; a name wins over a bad phone', () => {
    const p = parseCustomerTable([['Name', 'Phone'], ['', '12'], ['Omar', ''], ['Sara', '12']]);
    expect(p.rejected.map((r) => r.reason)).toEqual(['missing_name', 'missing_phone', 'invalid_phone']);
  });

  it('skips completely blank rows', () => {
    const p = parseCustomerTable([['Name', 'Phone'], ['', ''], ['  ', ' '], ['Sara', '0501234567']]);
    expect(p.rows).toHaveLength(1);
    expect(p.rejected).toHaveLength(0);
  });

  it('reports no_phone_column / no_name_column / no_rows', () => {
    expect(parseCustomerTable([['Name', 'City'], ['Sara', 'Riyadh']]).issue).toBe('no_phone_column');
    expect(parseCustomerTable([['Phone', 'City'], ['0501', 'Riyadh']]).issue).toBe('no_name_column');
    expect(parseCustomerTable([['Name', 'Phone']]).issue).toBe('no_rows');
    expect(parseCustomerTable([]).issue).toBe('no_rows');
  });

  it('a name or a number with a line break inside is an unreadable row (a quote swallowed lines), never a customer', () => {
    const p = parseCustomerTable([['Name', 'Phone'], ['Sara\nOmar', '0501234567'], ['Lina', '0502345678\n0503456789'], ['Nour', '0504567890']]);
    expect(p.rows.map((r) => r.name)).toEqual(['Nour']);
    expect(p.rejected.map((r) => r.reason)).toEqual(['unreadable', 'unreadable']);
    expect(p.unreadable).toBe(4);
    expect(p.rejected[0].name).not.toMatch(/[\r\n]/);
  });

  describe('phone numbers are read with the country of the workspace (R6-01)', () => {
    const table = [['Name', 'Phone'], ['A', '0501234567'], ['B', '501234567'], ['C', '+971 50 123 4567'], ['D', '00966501234567'], ['E', ARABIC_INDIC_PHONE], ['F', '966501110004.0']];

    it('Saudi Arabia (and a missing country): every local spelling becomes the same +966 number, sent with a plus', () => {
      for (const opts of [{}, { country: 'SA' }, { country: null }]) {
        const p = parseCustomerTable(table, opts);
        expect(p.rows.map((r) => r.phone)).toEqual(['+966501234567', '+966501234567', '+971501234567', '+966501234567', '+966501234567', '+966501110004']);
        expect(p.rows.map((r) => r.digits)).toEqual(['966501234567', '966501234567', '971501234567', '966501234567', '966501234567', '966501110004']);
      }
    });

    it('the Emirates: the same local numbers are +971, never Saudi', () => {
      const p = parseCustomerTable([['Name', 'Phone'], ['A', '0501234567'], ['B', '501234567']], { country: 'AE' });
      expect(p.rows.map((r) => r.phone)).toEqual(['+971501234567', '+971501234567']);
    });

    it('Kuwait: an 8-digit local number is +965; a Saudi-length number is not accepted (it would be a wrong number)', () => {
      const p = parseCustomerTable([['Name', 'Phone'], ['A', '51234567'], ['B', '0501234567']], { country: 'KW' });
      expect(p.rows.map((r) => r.phone)).toEqual(['+96551234567']);
      expect(p.rejected.map((r) => [r.name, r.reason])).toEqual([['B', 'invalid_phone']]);
    });

    it('Another country: only numbers with + or 00 are accepted; a local one is rejected with its own reason, the typed text is kept', () => {
      const p = parseCustomerTable([['Name', 'Phone'], ['A', '+44 7700 900123'], ['B', '07700900123'], ['C', '0044 7700 900124'], ['D', 'abc']], { country: 'OTHER' });
      expect(p.rows.map((r) => r.phone)).toEqual(['+447700900123', '+447700900124']);
      expect(p.rejected.map((r) => [r.name, r.phone, r.reason])).toEqual([['B', '07700900123', 'country_code_needed'], ['D', 'abc', 'invalid_phone']]);
    });

    it('rows whose phone is not a number go to the rejected list as invalid_phone, with the text exactly as typed', () => {
      const p = parseCustomerTable([
        ['Name', 'Phone'],
        ['A short', '1234567'], ['B ok', '+966 50 123 4567'], ['C letters', '0501234abc'], ['D plus', '050+1234567'], ['E long', '+1234567890123456'],
      ]);
      expect(p.rows.map((r) => r.name)).toEqual(['B ok']);
      expect(p.rejected.map((r) => [r.name, r.reason])).toEqual([['A short', 'invalid_phone'], ['C letters', 'invalid_phone'], ['D plus', 'invalid_phone'], ['E long', 'invalid_phone']]);
      expect(p.rejected.map((r) => r.phone)).toEqual(['1234567', '0501234abc', '050+1234567', '+1234567890123456']);
      expect(p.issue).toBeNull();
    });

    it('a file whose every phone is invalid has no rows to import but is not an issue (the preview shows what was skipped)', () => {
      const p = parseCustomerTable([['Name', 'Phone'], ['A', '12'], ['B', 'abc']]);
      expect(p.issue).toBeNull();
      expect(p.rows).toEqual([]);
      expect(p.rejected).toHaveLength(2);
    });
  });

  describe('the 5,000 row cap', () => {
    const table = (n: number): string[][] => [['Name', 'Phone'], ...Array.from({ length: n }, (_, i) => [`C${i}`, tenDigits(i)])];

    it('accepts exactly the server limit', () => {
      const p = parseCustomerTable(table(MAX_IMPORT_ROWS));
      expect(p.issue).toBeNull();
      expect(p.rows).toHaveLength(MAX_IMPORT_ROWS);
    });

    it('refuses one row more', () => {
      const p = parseCustomerTable(table(MAX_IMPORT_ROWS + 1));
      expect(p.issue).toBe('too_many');
      expect(p.rows).toHaveLength(0);
    });
  });
});

describe('consent columns: never inferred (R6-03)', () => {
  const file = (head: string[], ...rows: string[][]): ReturnType<typeof parseCustomerTable> => parseCustomerTable([['Name', 'Phone', ...head], ...rows.map((r) => ['Sara', '0501234567', ...r])]);

  it.each(['Opted in', 'Opt-in', 'Opt in', 'Consent', 'Marketing consent', 'WhatsApp consent', 'WhatsApp opt in', 'Subscribed', 'Agreed', 'Opted in (yes/no)', ar(0x627, 0x644, 0x645, 0x648, 0x627, 0x641, 0x642, 0x629), ar(0x645, 0x648, 0x627, 0x641, 0x642)])(
    '"%s" is THE opt-in column: a yes is a yes, anything else is a no', (header) => {
      const p = parseCustomerTable([['Name', 'Phone', header], ['A', '0501234567', 'yes'], ['B', '0502345678', 'no'], ['C', '0503456789', ''], ['D', '0504567890', 'maybe']]);
      expect(p.hasOptInColumn, header).toBe(true);
      expect(p.unknownConsentColumns).toEqual([]);
      expect(p.rows.map((r) => r.optIn)).toEqual(['yes', 'no', 'no', 'no']);
    });

  it.each([
    'Accepts Marketing', 'Accepts Email Marketing', 'Consent status', 'Marketing opt-in', 'Subscription status', 'Agreed to receive messages', 'Marketing',
    'Newsletter', 'GDPR consent', 'Permission', 'Opt in status', 'optin_status', 'Email subscribed', 'CONSENT GIVEN?', 'WhatsApp permission', 'Marketing emails',
    'Optedin', 'WhatsAppOptIn', 'Opted-in status', 'Marketing (yes/no)', 'Status (subscribed / unsubscribed)', 'Status (opted in?)',
    ar(0x627, 0x644, 0x645, 0x648, 0x627, 0x641, 0x642, 0x629, 0x20, 0x627, 0x644, 0x62a, 0x633, 0x648, 0x64a, 0x642, 0x64a, 0x629), // the marketing consent
    ar(0x62d, 0x627, 0x644, 0x629, 0x20, 0x627, 0x644, 0x627, 0x634, 0x62a, 0x631, 0x627, 0x643), // subscription status
  ])('"%s" looks like consent but is NOT understood: reported by name, not used, no row is a yes', (header) => {
    const p = file([header], ['yes'], ['no']);
    expect(p.hasOptInColumn, header).toBe(false);
    expect(p.unknownConsentColumns, header).toEqual([header]);
    expect(p.rows.map((r) => r.optIn)).toEqual(['unset', 'unset']);
  });

  it.each(['Status', 'City', 'Points', 'Loyalty tier', 'Tags2', 'Optional note', 'Options', 'Adoption', 'Adopted', 'Optical store', 'City (optional)', 'Department'])(
    '"%s" does not look like consent: nothing is reported', (header) => {
      const p = file([header], ['x']);
      expect(p.unknownConsentColumns).toEqual([]);
      expect(p.optOutColumns).toEqual([]);
    });

  it('a header that mixes "subscribed" and "unsubscribed" is not understood either way (never guessed as an opt-out column)', () => {
    const p = file(['Status (subscribed / unsubscribed)'], ['subscribed'], ['unsubscribed']);
    expect(p.optOutColumns).toEqual([]);
    expect(p.unknownConsentColumns).toEqual(['Status (subscribed / unsubscribed)']);
    expect(p.rows.map((r) => r.optIn)).toEqual(['unset', 'no']); // the word "unsubscribed" in a cell still keeps that row out
  });

  it('a long or odd header is shortened and cleaned before it is shown', () => {
    const lrm = ar(0x200e);
    const p = file([`Marketing consent status ${'x'.repeat(80)}`, `Newsletter${lrm}\n`], ['a', 'b']);
    expect(p.unknownConsentColumns[0].length).toBeLessThanOrEqual(43);
    expect(p.unknownConsentColumns[0].endsWith('...')).toBe(true);
    expect(p.unknownConsentColumns[1]).toBe('Newsletter');
  });

  describe('explicit negatives always win', () => {
    it.each([
      ['Unsubscribed', 'yes'], ['Unsubscribed', 'true'], ['Unsubscribed', '1'], ['Unsubscribed', '2024-01-05'], ['Unsubscribed', 'unsure'],
      ['Opted out', 'Y'], ['Opt-out', 'yes'], ['Do not contact', 'yes'], ['DNC', 'x'], ['Blocked', 'true'], ['Stop', 'yes'], ['Unsubscribe', 'yes'],
      [ar(0x625, 0x644, 0x63a, 0x627, 0x621, 0x20, 0x627, 0x644, 0x627, 0x634, 0x62a, 0x631, 0x627, 0x643), 'yes'], // unsubscribing
      [ar(0x645, 0x62d, 0x638, 0x648, 0x631), ar(0x646, 0x639, 0x645)], // blocked: yes
    ])('column "%s" = "%s": the row is a no, even next to a recognised yes', (header, value) => {
      const p = parseCustomerTable([['Name', 'Phone', 'Opted in', header], ['Sara', '0501234567', 'yes', value], ['Omar', '0502345678', 'yes', 'no']]);
      expect(p.optOutColumns).toEqual([header]);
      expect(p.unknownConsentColumns).toEqual([]);
      expect(p.rows.map((r) => r.optIn)).toEqual(['no', 'yes']);
    });

    it.each(['no', 'No', 'N', 'false', '0', '', '-', 'none', 'n/a'])('an opt-out column with "%s" does not mark the row', (value) => {
      const p = file(['Unsubscribed'], [value]);
      expect(p.rows[0].optIn).toBe('unset');
    });

    it('without an opt-in column the marked rows are still a no and the others say nothing', () => {
      const p = file(['Do not contact'], ['yes'], ['no'], ['']);
      expect(p.hasOptInColumn).toBe(false);
      expect(p.rows.map((r) => r.optIn)).toEqual(['no', 'unset', 'unset']);
    });

    it('a whole cell that says unsubscribed / opted out / blocked in a column that is not named like that also marks the row', () => {
      const p = parseCustomerTable([
        ['Name', 'Phone', 'Status', 'Tags'],
        ['A', '0501234567', 'Unsubscribed', ''], ['B', '0502345678', 'subscribed', ''], ['C', '0503456789', 'active', 'opted out'], ['D', '0504567890', 'active', 'asked to stop yesterday'],
        ['E', '0505678901', 'Blocked', ''], ['F', '0506789012', 'do not contact', ''],
      ]);
      expect(p.rows.map((r) => r.optIn)).toEqual(['no', 'unset', 'no', 'unset', 'no', 'no']);
    });

    it('a recognised no or a blank in the opt-in column is a no; two opt-in columns must BOTH say yes', () => {
      const p = parseCustomerTable([
        ['Name', 'Phone', 'Opted in', 'WhatsApp consent'],
        ['A', '0501234567', 'yes', 'yes'], ['B', '0502345678', 'yes', 'no'], ['C', '0503456789', 'no', 'yes'], ['D', '0504567890', 'yes', ''],
      ]);
      expect(p.rows.map((r) => r.optIn)).toEqual(['yes', 'no', 'no', 'no']);
    });
  });

  it('opt-in source and date come ONLY from columns named after the opt-in (a plain Date or Source column is not consent evidence)', () => {
    const p = parseCustomerTable([
      ['Name', 'Phone', 'Opted in', 'Source', 'Date', 'Opt-in source', 'Consent date'],
      ['A', '0501234567', 'yes', 'Instagram', '2023-05-05', 'Web form', '2024-01-02'],
    ]);
    expect(p.rows[0]).toMatchObject({ source: 'Web form', date: '2024-01-02', optIn: 'yes' });
    const only = parseCustomerTable([['Name', 'Phone', 'Opted in', 'Source', 'Date'], ['A', '0501234567', 'yes', 'Instagram', '2023-05-05']]);
    expect(only.rows[0]).toMatchObject({ source: '', date: '' });
    expect(only.unknownConsentColumns).toEqual([]); // "Source" and "Date" are not consent columns either
  });

  it('broad evidence headers ("Date of consent", "Marketing consent source") are evidence columns, not unknown consent columns', () => {
    const p = parseCustomerTable([['Name', 'Phone', 'Opted in', 'Date of consent', 'Marketing consent source'], ['A', '0501234567', 'yes', '2024-02-02', 'Store tablet']]);
    expect(p.unknownConsentColumns).toEqual([]);
    expect(p.rows[0]).toMatchObject({ source: 'Store tablet', date: '2024-02-02' });
  });

  it('the header of the template this module generates is understood: opt-in column, no unknown consent column', () => {
    const p = parseCustomerFileText(buildCustomerTemplateCsv(true));
    expect(p.issue).toBe('no_rows');
    expect(p.hasOptInColumn).toBe(true);
    expect(p.hasLanguageColumn).toBe(true);
    expect(p.unknownConsentColumns).toEqual([]);
    const full = parseCustomerFileText(`${buildCustomerTemplateCsv(false)}\nSara,0501234567,yes,In store form,2026-09-01,,`);
    expect(full.rows[0]).toMatchObject({ optIn: 'yes', source: 'In store form', date: '2026-09-01' });
    expect(full.unknownConsentColumns).toEqual([]);
  });
});

describe('parseCustomerFileText', () => {
  it('reads a semicolon file with a BOM, CRLF and Arabic names', () => {
    const text = `${BOM}Name;Phone;Opted in\r\n${FATIMA};${ARABIC_INDIC_PHONE};yes\r\nOmar;0502345678;no\r\n`;
    const p = parseCustomerFileText(text);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ name: FATIMA, phone: '+966501234567', optIn: 'yes' });
  });

  it('passes the country on and reports the lines that could not be read together with the rejected rows', () => {
    const p = parseCustomerFileText('Name,Phone\nSara,0501234567\n"Broken,0509999999\nOmar,0502345678\n', { country: 'AE' });
    expect(p.rows.map((r) => r.phone)).toEqual(['+971501234567', '+971502345678']);
    expect(p.unreadable).toBe(1);
    expect(p.rejected).toEqual([rej({ name: '"Broken,0509999999', reason: 'unreadable' })]);
  });
});

describe('parsePasteText', () => {
  it('reads name, phone per line with comma, semicolon and tab; nobody is marked (unset)', () => {
    const tab = String.fromCharCode(9);
    const p = parsePasteText(`Sara, 0501234567\nOmar; 0502345678\nLina${tab}0503456789\n`);
    expect(p.rows.map((r) => [r.name, r.phone])).toEqual([['Sara', '+966501234567'], ['Omar', '+966502345678'], ['Lina', '+966503456789']]);
    expect(p.hasOptInColumn).toBe(false);
    expect(p.rows.every((r) => r.optIn === 'unset')).toBe(true);
  });

  it('reads the number with the workspace country', () => {
    expect(parsePasteText('Sara, 0501234567', { country: 'AE' }).rows[0].phone).toBe('+971501234567');
    expect(parsePasteText('Sara, 51234567', { country: 'KW' }).rows[0].phone).toBe('+96551234567');
    const other = parsePasteText('Sara, 07700900123\nOmar, +44 7700 900123', { country: 'OTHER' });
    expect(other.rows.map((r) => r.phone)).toEqual(['+447700900123']);
    expect(other.rejected.map((r) => r.reason)).toEqual(['country_code_needed']);
  });

  it('accepts the Arabic comma as a separator', () => {
    const p = parsePasteText(`${FATIMA}${ar(0x60c)} ${ARABIC_INDIC_PHONE}`);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ name: FATIMA, phone: '+966501234567' });
  });

  it('handles quoted names with a comma, CRLF and blank lines', () => {
    const p = parsePasteText('"Ahmed, Sara", 0501234567\r\n\r\nOmar, 0502345678\r\n');
    expect(p.rows.map((r) => r.name)).toEqual(['Ahmed, Sara', 'Omar']);
  });

  it('turns lines without a name or a phone into rejected rows', () => {
    const p = parsePasteText('Sara\n0501234567\n, 0505555555\nOmar,\nLina, 0506666666');
    expect(p.rows.map((r) => r.name)).toEqual(['Lina']);
    expect(p.rejected.map((r) => r.reason)).toEqual(['missing_phone', 'missing_name', 'missing_name', 'missing_phone']);
  });

  it('invalid numbers become skipped rows with the reason invalid_phone; good ones in the same paste are kept', () => {
    const p = parsePasteText(`Sara, 0501234567\nOmar, 12345\nLina, 050+1234567\nNour, abc\nHessa, ${ARABIC_INDIC_PHONE}\nKhaled, 1234567890123456`);
    expect(p.rows.map((r) => r.name)).toEqual(['Sara', 'Hessa']);
    expect(p.rejected.map((r) => [r.name, r.phone, r.reason])).toEqual([
      ['Omar', '12345', 'invalid_phone'], ['Lina', '050+1234567', 'invalid_phone'], ['Nour', 'abc', 'invalid_phone'],
      ['Khaled', '1234567890123456', 'invalid_phone'],
    ]);
  });

  it('splits "Name 0501234567" typed with a space only', () => {
    const p = parsePasteText('Sara Ahmed 0501234567');
    expect(p.rows[0]).toMatchObject({ name: 'Sara Ahmed', phone: '+966501234567' });
  });

  it('skips a header line', () => {
    const p = parsePasteText('Name, Phone\nSara, 0501234567');
    expect(p.rows).toHaveLength(1);
    expect(p.rejected).toHaveLength(0);
    expect(parsePasteText('Name, Phone, Opted in\nSara, 0501234567, yes').rows[0].optIn).toBe('yes');
  });

  it('reports no_rows and too_many', () => {
    expect(parsePasteText('  \n \n').issue).toBe('no_rows');
    expect(parsePasteText('').issue).toBe('no_rows');
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `C${i}, ${tenDigits(i)}`).join('\n');
    expect(parsePasteText(many).issue).toBe('too_many');
    expect(parsePasteText(many.split('\n').slice(0, MAX_IMPORT_ROWS).join('\n')).issue).toBeNull();
  });

  describe('the optional third value (R6-03 d)', () => {
    it.each(['yes', 'Yes', 'y', 'true', '1', 'agreed', NAAM])('"%s" is a yes', (third) => {
      expect(parsePasteText(`Sara, 0501234567, ${third}`).rows[0].optIn).toBe('yes');
    });

    it.each(['no', 'n', 'false', '0', 'maybe', 'unsure', 'unsubscribed', 'stop', 'yes!', 'Yes.', 'x'])('"%s" is a no (anything non-empty that is not a yes)', (third) => {
      expect(parsePasteText(`Sara, 0501234567, ${third}`).rows[0].optIn).toBe('no');
    });

    it('an empty third value, or none, says nothing (follows the merchant\'s answer)', () => {
      const p = parsePasteText('Sara, 0501234567,\nOmar, 0502345678, \nLina, 0503456789');
      expect(p.rows.map((r) => r.optIn)).toEqual(['unset', 'unset', 'unset']);
    });

    it('works with semicolons and tabs, and the list never claims an opt-in COLUMN', () => {
      const p = parsePasteText('Sara; 0501234567; no\nOmar; 0502345678; yes');
      expect(p.rows.map((r) => r.optIn)).toEqual(['no', 'yes']);
      expect(p.hasOptInColumn).toBe(false);
    });
  });

  it('a line whose quote is never closed is a line that could not be read (counted, in the skipped rows), the others are kept', () => {
    const p = parsePasteText('Sara, 0501234567\n"Omar, 0502345678\nLina, 0503456789');
    expect(p.rows.map((r) => r.name)).toEqual(['Sara', 'Lina']);
    expect(p.unreadable).toBe(1);
    expect(p.rejected).toEqual([rej({ name: '"Omar, 0502345678', reason: 'unreadable' })]);
  });
});

describe('splitByOptIn (compliance)', () => {
  const names = (r: CustomerRow[]): string[] => r.map((x) => x.name);

  describe('modes', () => {
    const rows = [person('1', 'yes'), person('2', 'no'), person('3', 'yes'), person('4', 'unset')];

    it('rows mode + attestation: only the clear yes rows are attested; no, unclear and unset go to the plain job', () => {
      const s = splitByOptIn(rows, { consent: 'rows', attest: true });
      expect(names(s.attested)).toEqual(['1', '3']);
      expect(names(s.plain)).toEqual(['2', '4']);
    });

    it('all mode + attestation: everybody except the explicit negatives is attested', () => {
      const s = splitByOptIn(rows, { consent: 'all', attest: true });
      expect(names(s.attested)).toEqual(['1', '3', '4']);
      expect(names(s.plain)).toEqual(['2']);
    });

    it.each(['rows', 'all', 'none'] as const)('mode %s WITHOUT the attestation: nothing is attested', (consent) => {
      const s = splitByOptIn(rows, { consent, attest: false });
      expect(s.attested).toEqual([]);
      expect(names(s.plain)).toEqual(['1', '2', '3', '4']);
      expect(s.conflicting).toBe(0);
    });

    it('"Not sure" (none) is unattested even with a ticked box', () => {
      const s = splitByOptIn(rows, { consent: 'none', attest: true });
      expect(s.attested).toEqual([]);
      expect(s.plain).toHaveLength(4);
    });

    it('only a literal true counts as the attestation', () => {
      const s = splitByOptIn(rows, { consent: 'all', attest: 'true' as unknown as boolean });
      expect(s.attested).toEqual([]);
    });

    it('does not change the input array', () => {
      const copy = rows.slice();
      splitByOptIn(rows, { consent: 'rows', attest: true });
      expect(rows).toEqual(copy);
    });

    it('keeps the order of the rows inside each job', () => {
      const many = ['5', '4', '3', '2', '1'].map((id) => person(id, 'yes'));
      expect(names(splitByOptIn(many, { consent: 'rows', attest: true }).attested)).toEqual(['5', '4', '3', '2', '1']);
    });
  });

  describe('the same person twice (R6-04)', () => {
    it('yes and no for one number: BOTH rows go to the plain job, they are counted as conflicting', () => {
      const a = person('7', 'yes', { name: 'A' });
      const b = person('7', 'no', { name: 'B' });
      for (const consent of ['rows', 'all'] as const) {
        const s = splitByOptIn([a, b, person('8', 'yes', { name: 'C' })], { consent, attest: true });
        expect(names(s.attested)).toEqual(['C']);
        expect(names(s.plain)).toEqual(['A', 'B']);
        expect(s.conflicting).toBe(2);
        expect(s.repeated).toBe(1);
      }
    });

    it('the order of the two rows does not matter', () => {
      const s = splitByOptIn([person('7', 'no', { name: 'B' }), person('7', 'yes', { name: 'A' })], { consent: 'rows', attest: true });
      expect(s.attested).toEqual([]);
      expect(names(s.plain)).toEqual(['B', 'A']);
    });

    it('two different spellings of the same number are one person (they normalise to the same digits)', () => {
      const t = parseCustomerTable([['Name', 'Phone', 'Opted in'], ['Sara', '0501234567', 'yes'], ['Sara A', '+966501234567', 'no'], ['Omar', '0509999999', 'yes']]);
      const s = splitByOptIn(t.rows, { consent: 'rows', attest: true });
      expect(names(s.attested)).toEqual(['Omar']);
      expect(names(s.plain)).toEqual(['Sara', 'Sara A']);
      expect(s.conflicting).toBe(2);
    });

    it('yes and yes (a plain duplicate) stays attested, and is counted as repeated, not as conflicting', () => {
      const s = splitByOptIn([person('7', 'yes', { name: 'A' }), person('7', 'yes', { name: 'B' })], { consent: 'rows', attest: true });
      expect(names(s.attested)).toEqual(['A', 'B']);
      expect(s.conflicting).toBe(0);
      expect(s.repeated).toBe(1);
    });

    it('under "all", an unset row next to a yes is fine; next to a no it is not', () => {
      const ok = splitByOptIn([person('7', 'unset', { name: 'A' }), person('7', 'yes', { name: 'B' })], { consent: 'all', attest: true });
      expect(names(ok.attested)).toEqual(['A', 'B']);
      const bad = splitByOptIn([person('7', 'unset', { name: 'A' }), person('7', 'no', { name: 'B' })], { consent: 'all', attest: true });
      expect(bad.attested).toEqual([]);
      expect(bad.conflicting).toBe(2);
    });

    it('under "rows", an unset row next to a yes is NOT a clear yes: the group goes to the plain job', () => {
      const s = splitByOptIn([person('7', 'unset', { name: 'A' }), person('7', 'yes', { name: 'B' })], { consent: 'rows', attest: true });
      expect(s.attested).toEqual([]);
    });

    it('a collision on the last 9 digits (two countries, the same national part) can only WITHHOLD consent', () => {
      const sa = row({ name: 'SA', phone: '+966501234567', digits: '966501234567', optIn: 'yes' });
      const ae = row({ name: 'AE', phone: '+971501234567', digits: '971501234567', optIn: 'no' });
      const s = splitByOptIn([sa, ae], { consent: 'rows', attest: true });
      expect(s.attested).toEqual([]);
      expect(s.conflicting).toBe(2);
      expect(s.repeated).toBe(0); // different numbers: not a repeated row
      const both = splitByOptIn([sa, row({ ...ae, optIn: 'yes' })], { consent: 'rows', attest: true });
      expect(both.attested).toHaveLength(2); // two clear yes: nothing to withhold
    });

    it('a repeated row is counted by the exact number', () => {
      const s = splitByOptIn([person('7', 'no'), person('7', 'no'), person('7', 'no'), person('9', 'no')], { consent: 'rows', attest: true });
      expect(s.repeated).toBe(2);
      expect(s.conflicting).toBe(0);
    });
  });
});

describe('notes, job file, template', () => {
  it('appends the opt-in source and date to Notes ONLY for a row of the attested job', () => {
    const r = row({ optIn: 'yes', source: 'In store form', date: '2026-09-01', notes: 'VIP' });
    expect(notesFor(r, true)).toBe(`VIP; ${NOTES_OPT_IN_PREFIX}In store form, 2026-09-01`);
    expect(notesFor(row({ optIn: 'yes', source: 'Web form' }), true)).toBe(`${NOTES_OPT_IN_PREFIX}Web form`);
    expect(notesFor(row({ optIn: 'yes', date: '2026-09-01' }), true)).toBe(`${NOTES_OPT_IN_PREFIX}2026-09-01`);
    // a row added WITHOUT permission never claims an opt-in, whatever the file said
    expect(notesFor(r)).toBe('VIP');
    expect(notesFor(r, false)).toBe('VIP');
  });

  it('does not add an opt-in note without source and date', () => {
    expect(notesFor(row({ optIn: 'yes', notes: 'VIP' }), true)).toBe('VIP');
    expect(notesFor(row({ optIn: 'no', source: '', date: '' }), true)).toBe('');
  });

  it('builds the job CSV with canonical headers the engine auto-maps and the phone as "+<digits>"', () => {
    const csv = buildJobCsv([row({ name: 'Ahmed, Sara', email: 'a@b.co', optIn: 'yes', source: 'Form', date: '2026-09-01' })], false, true);
    const t = parseCsvText(csv, ',');
    expect(t[0]).toEqual(['Name', 'Phone', 'Email', 'Notes']);
    expect(t[1]).toEqual(['Ahmed, Sara', '+966501234567', 'a@b.co', `${NOTES_OPT_IN_PREFIX}Form, 2026-09-01`]);
  });

  it('the plain job file carries no opt-in note', () => {
    const csv = buildJobCsv([row({ optIn: 'yes', source: 'Form', date: '2026-09-01' })], false, false);
    expect(parseCsvText(csv, ',')[1][3]).toBe('');
    expect(csv).not.toContain(NOTES_OPT_IN_PREFIX);
  });

  it('adds the Language column only when Arabic is on and a row has a language', () => {
    const rows = [row({ language: 'ar' })];
    expect(parseCsvText(buildJobCsv(rows, true), ',')[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Language']);
    expect(parseCsvText(buildJobCsv(rows, false), ',')[0]).toEqual(['Name', 'Phone', 'Email', 'Notes']);
    expect(parseCsvText(buildJobCsv([row()], true), ',')[0]).toEqual(['Name', 'Phone', 'Email', 'Notes']);
  });

  it('never writes a consent column into the job file', () => {
    const csv = buildJobCsv([row({ optIn: 'yes' })], true, true);
    expect(csv.toLowerCase()).not.toContain('opt');
    expect(csv.toLowerCase()).not.toContain('consent');
  });

  it('template: HEADER ONLY (ruling 3): opt-in / source / date / email / notes columns, Language only when Arabic is on, no data row', () => {
    const offText = buildCustomerTemplateCsv(false);
    const off = parseCsvText(offText, ',');
    expect(off).toHaveLength(1);
    expect(off[0]).toEqual(['Name', 'Phone', 'Opted in (yes/no)', 'Opt-in source', 'Opt-in date', 'Email', 'Notes']);
    expect(offText).not.toContain(String.fromCharCode(10));
    const onText = buildCustomerTemplateCsv(true);
    const on = parseCsvText(onText, ',');
    expect(on).toHaveLength(1);
    expect(on[0][on[0].length - 1]).toBe('Language (en/ar)');
    for (const text of [offText, onText]) {
      expect(text).not.toMatch(/[0-9]/);
      expect(text).not.toContain('@');
      expect(text.toLowerCase()).not.toContain('sara');
    }
  });

  it('toCsv quotes commas, quotes and newlines (and leaves a phone with a plus alone: the import files are NOT formula-guarded)', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['l1\nl2', '']])).toBe('a,b\n"x,y","say ""hi"""\n"l1\nl2",');
    expect(toCsv(['Phone'], [['+966501234567'], ['=1+1']])).toBe('Phone\n+966501234567\n=1+1');
  });
});

describe('mergeErrorReports', () => {
  const reason = (r: string): string => `[${r}]`;

  it('merges the engine reports of two jobs and the rejected rows into ONE CSV with a single Reason column', () => {
    const job1 = 'Name,Phone,Email,Notes,Reason\nBad,12,,,Phone is not a valid phone number';
    const job2 = 'Name,Phone,Email,Notes,Reason\nWorse,34,,n,Phone is not a valid phone number';
    const rejected = [
      rej({ phone: '0505', reason: 'missing_name' }),
      rej({ name: 'Omar', reason: 'missing_phone' }),
    ];
    const merged = parseCsvText(mergeErrorReports([job1, job2], rejected, reason), ',');
    expect(merged[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Reason']);
    expect(merged).toHaveLength(5);
    expect(merged[1]).toEqual(['Bad', '12', '', '', 'Phone is not a valid phone number']);
    expect(merged[2]).toEqual(['Worse', '34', '', 'n', 'Phone is not a valid phone number']);
    expect(merged[3]).toEqual(['', '0505', '', '', '[missing_name]']);
    expect(merged[4]).toEqual(['Omar', '', '', '', '[missing_phone]']);
    expect(merged.every((r) => r.length === 5)).toBe(true);
  });

  it('writes every client-side reason like the others, in the same single Reason column', () => {
    const merged = parseCsvText(mergeErrorReports([], [
      rej({ name: 'Omar', phone: '12345', reason: 'invalid_phone' }), rej({ name: 'Lina', phone: '07700900123', reason: 'country_code_needed' }),
      rej({ name: '"Broken,0509999999', reason: 'unreadable' }),
    ], reason), ',');
    expect(merged).toEqual([
      ['Name', 'Phone', 'Email', 'Notes', 'Reason'], ['Omar', '12345', '', '', '[invalid_phone]'], ['Lina', '07700900123', '', '', '[country_code_needed]'],
      ['"Broken,0509999999', '', '', '', '[unreadable]'],
    ]);
  });

  it('works with only rejected rows (no engine report)', () => {
    const merged = parseCsvText(mergeErrorReports([], [rej({ name: 'Omar', reason: 'missing_phone' })], reason), ',');
    expect(merged).toEqual([['Name', 'Phone', 'Email', 'Notes', 'Reason'], ['Omar', '', '', '', '[missing_phone]']]);
  });

  it('works with only an engine report', () => {
    const merged = parseCsvText(mergeErrorReports(['Name,Phone,Email,Notes,Reason\nA,1,,,bad'], [], reason), ',');
    expect(merged).toEqual([['Name', 'Phone', 'Email', 'Notes', 'Reason'], ['A', '1', '', '', 'bad']]);
  });

  it('keeps a Language column when the engine report has one, and quotes values safely', () => {
    const rep = 'Name,Phone,Email,Notes,Language,Reason\n"A, B",1,,,ar,"bad, really"';
    const merged = parseCsvText(mergeErrorReports([rep], [rej({ name: 'X', language: 'en', reason: 'missing_phone' })], reason), ',');
    expect(merged[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Language', 'Reason']);
    expect(merged[1]).toEqual(['A, B', '1', '', '', 'ar', 'bad, really']);
    expect(merged[2]).toEqual(['X', '', '', '', 'en', '[missing_phone]']);
  });

  it('reads a downloaded Blob as text', async () => {
    expect(await blobToText(new Blob(['a,b']))).toBe('a,b');
  });

  describe('formula injection guard (R6-08)', () => {
    const merge = (r: RejectedRow[], reports: string[] = []): string[][] => parseCsvText(mergeErrorReports(reports, r, reason), ',');
    const BAD = ["=cmd|' /C calc'!A0", '@SUM(1+1)', '-2+3', '+1+1', '=HYPERLINK("http://x.test","click")'];

    it.each(BAD)('a text cell that starts with a formula character gets a leading apostrophe: %s', (cell) => {
      const t = merge([rej({ name: cell, email: cell, notes: cell, language: cell, reason: 'missing_phone' })]);
      expect(t[1].slice(0, 2)).toEqual([`'${cell}`, '']);
      expect(t[1][2]).toBe(`'${cell}`); // email
      expect(t[1][3]).toBe(`'${cell}`); // notes
    });

    it('tab and CR at the start are guarded too', () => {
      const t = merge([rej({ name: '\t=1+1', notes: '\r=1+1', reason: 'missing_phone' })]);
      expect(t[1][0]).toBe("'\t=1+1");
    });

    it('the engine report rows are guarded the same way (name, notes, reason)', () => {
      const rep = 'Name,Phone,Email,Notes,Reason\n=cmd,+966501234567,,@SUM(1),-evil';
      const t = merge([], [rep]);
      expect(t[1]).toEqual(["'=cmd", '+966501234567', '', "'@SUM(1)", "'-evil"]);
    });

    it('the Reason column of a client-side rejection is guarded too', () => {
      const t = parseCsvText(mergeErrorReports([], [rej({ name: 'Omar', reason: 'missing_phone' })], () => '=reason'), ',');
      expect(t[1][4]).toBe("'=reason");
    });

    it.each(['+966501234567', '+966 50 123 4567', '+966-50-123-4567', '(050) 123-4567', '-0501234567', '+(966) 501.234.567', `+${ARABIC_INDIC_PHONE}`])(
      'a genuine phone number in the Phone column is NEVER prefixed (a prefixed plus would be read as a local number on re-upload): %s', (phone) => {
        expect(merge([rej({ name: 'Omar', phone, reason: 'invalid_phone' })])[1][1]).toBe(phone);
      });

    it.each(BAD)('a formula in the Phone column is guarded: %s', (cell) => {
      expect(merge([rej({ name: 'Omar', phone: cell, reason: 'invalid_phone' })])[1][1]).toBe(`'${cell}`);
    });

    it.each(['+', '-', '+abc', '+966abc', '++966501234567'])('a phone cell that starts with a formula character but has no number shape is guarded: %s', (cell) => {
      expect(merge([rej({ name: 'Omar', phone: cell, reason: 'invalid_phone' })])[1][1]).toBe(`'${cell}`);
    });

    it('cells that do not start with a formula character are untouched', () => {
      const t = merge([rej({ name: 'Sara = Ahmed', email: 'a@b.co', notes: 'a+b', reason: 'missing_phone' })]);
      expect(t[1].slice(0, 4)).toEqual(['Sara = Ahmed', '', 'a@b.co', 'a+b']);
    });

    it('the header cells are guarded the same way and the Phone header is not special', () => {
      const t = merge([], ['Name,Phone,Email,Notes,Reason\nA,1,,,bad']);
      expect(t[0]).toEqual(['Name', 'Phone', 'Email', 'Notes', 'Reason']);
    });
  });
});
