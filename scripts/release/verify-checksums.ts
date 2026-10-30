import { verifyChecksums } from './checksum-verification.ts';

async function main(checksumFiles: string[]): Promise<number> {
  if (checksumFiles.length === 0) {
    console.error('usage: node scripts/release/verify-checksums.ts <SHA256SUMS> [...]');
    return 2;
  }
  const reports = await Promise.all(checksumFiles.map(async (file) => ({ file, report: await verifyChecksums(file) })));
  const problems = reports.flatMap(({ file, report }) => report.problems.map((problem) => `${file}: ${problem}`));
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(problem));
    return 1;
  }
  reports.forEach(({ file, report }) => console.log(`checksums ${file} valid: ${report.entries.length} files`));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
