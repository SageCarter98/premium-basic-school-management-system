import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, counts } from './build.js';
import { DEFAULT_CONFIG, PROFILES, type Profile, type SeedConfig } from './config.js';
import { assertValid, check } from './invariants.js';
import { writeCredentials } from './writers/credentials.js';
import { fingerprint, writeJson, writeStreamed } from './writers/json.js';
import { isolationProbeSql, sqlChunks } from './writers/sql.js';

function parseArgs(argv: string[]): { cfg: SeedConfig; out: string; format: string; checkOnly: boolean; verify: boolean } {
  const cfg: SeedConfig = { ...DEFAULT_CONFIG };
  let out = 'fixtures';
  let format = 'both';
  let checkOnly = false;
  let verify = false;

  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=');
    const value = inlineValue ?? argv[i + 1];
    const consume = () => { if (inlineValue === undefined) i++; };

    switch (flag) {
      case '--seed': cfg.seed = value; consume(); break;
      case '--profile': {
        if (!(value in PROFILES)) throw new Error(`Unknown profile "${value}". Use ci, dev or volume.`);
        cfg.profile = value as Profile; consume(); break;
      }
      case '--as-of': cfg.asOf = value; consume(); break;
      case '--cardinality': {
        if (value !== 'many_to_many' && value !== 'one_to_many') {
          throw new Error('--cardinality must be many_to_many or one_to_many');
        }
        cfg.guardianCardinality = value; consume(); break;
      }
      case '--hash': {
        if (value !== 'scrypt' && value !== 'none') throw new Error('--hash must be scrypt or none');
        cfg.hashMode = value; consume(); break;
      }
      case '--session-var': cfg.rlsSessionVar = value; consume(); break;
      case '--schema': cfg.sqlSchema = value; consume(); break;
      case '--out': out = value; consume(); break;
      case '--format': format = value; consume(); break;
      case '--check-only': checkOnly = true; break;
      case '--verify-determinism': verify = true; break;
      case '--help': case '-h': printHelp(); process.exit(0);
      default:
        if (flag.startsWith('--')) throw new Error(`Unknown flag ${flag}`);
    }
  }
  return { cfg, out, format, checkOnly, verify };
}

function printHelp(): void {
  console.log(`pbsms-seed — deterministic fixture generator

  --seed <string>            RNG seed (default: ${DEFAULT_CONFIG.seed})
  --profile <ci|dev|volume>  Data volume (default: ${DEFAULT_CONFIG.profile})
  --as-of <YYYY-MM-DD>       Date the fixture represents (default: ${DEFAULT_CONFIG.asOf})
  --cardinality <many_to_many|one_to_many>
                             FR-STU-020 guardian rule under test
  --hash <scrypt|none>       Password hashing (default: ${DEFAULT_CONFIG.hashMode})
  --session-var <name>       RLS session variable (default: ${DEFAULT_CONFIG.rlsSessionVar})
  --schema <name>            Postgres schema for SQL output
  --out <dir>                Output directory (default: fixtures)
  --format <json|sql|both>   What to write
  --check-only               Run invariants, write nothing
  --verify-determinism       Build twice and compare fingerprints
`);
}

async function main(): Promise<void> {
  const { cfg, out, format, checkOnly, verify } = parseArgs(process.argv.slice(2));

  const graph = build(cfg);
  const fp = fingerprint(graph);

  if (verify) {
    const again = build(cfg);
    const fp2 = fingerprint(again);
    if (fp !== fp2) {
      console.error(`DETERMINISM FAILURE: ${fp} != ${fp2}`);
      console.error('Something in the generator is reading the clock, Math.random, or object iteration order.');
      process.exit(2);
    }
    console.log(`determinism ok  ${fp}`);
  }

  const violations = check(graph, cfg);
  if (violations.length > 0) {
    try { assertValid(graph, cfg); } catch (e) { console.error((e as Error).message); }
    process.exit(1);
  }

  const c = counts(graph);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  console.log(`seed=${cfg.seed} profile=${cfg.profile} as_of=${cfg.asOf} cardinality=${cfg.guardianCardinality} hash=${cfg.hashMode}`);
  console.log(`fingerprint=${fp}  rows=${total}`);
  console.log(
    Object.entries(c)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `  ${k.padEnd(24)} ${n}`)
      .join('\n'),
  );

  if (checkOnly) { console.log('invariants ok (nothing written)'); return; }

  mkdirSync(out, { recursive: true });
  const written: string[] = [];
  if (format === 'json' || format === 'both') written.push(...(await writeJson(graph, out)));
  if (format === 'sql' || format === 'both') {
    const sqlPath = join(out, 'seed.sql');
    await writeStreamed(sqlPath, sqlChunks(graph, cfg));
    written.push(sqlPath);
    const probePath = join(out, 'isolation-probe.sql');
    writeFileSync(probePath, isolationProbeSql(graph, cfg));
    written.push(probePath);
  }
  written.push(writeCredentials(graph, cfg, out));
  writeFileSync(join(out, 'FINGERPRINT'), `${fp}\n`);
  written.push(join(out, 'FINGERPRINT'));

  console.log(`\nwrote:\n${written.map((w) => `  ${w}`).join('\n')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
