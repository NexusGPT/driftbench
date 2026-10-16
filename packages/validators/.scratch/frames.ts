import nlp from 'compromise/two';
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const heads = [
 'Backfill missing timestamps in logs/2026-10.csv.','Deduplicate contacts exported from the old CRM.','Whitelist the vendor domain in the mail filter.','Defragment the cache directory before noon.','Calibrate sensors against the reference gauge.','Triage incoming tickets by severity.','Inventory the spare parts in cabinet 7.','Anonymise customer records older than two years.','Summarise last week incident reports for the board.','Draft release notes for version 4.2.','Tag every orphaned volume with its owner.','Compare supplier quotes against the approved budget.',
 'Sales report for October.','Weekly sales summary by region.','Records from the inspection.','Invoice batch for April.','Supplier contact list.','Audit lane for ledger checks.','Archive files from 2019.','Customer order history.','Price list for spare parts.','Order totals from last week.',
];
for (const s of heads) {
  const f = (t: string) => nlp(t).json().flatMap((x: any) => x.terms)[0];
  const plain = f(s).tags.slice(0,3).join('/');
  const to = nlp(`to ${lower(s)}`).json().flatMap((x: any) => x.terms)[1].tags.slice(0,3).join('/');
  const you = nlp(`You ${lower(s)}`).json().flatMap((x: any) => x.terms)[1].tags.slice(0,3).join('/');
  const pls = nlp(`Please ${lower(s)}`).json().flatMap((x: any) => x.terms)[1].tags.slice(0,3).join('/');
  console.log(s.slice(0,40).padEnd(42), 'plain', plain.padEnd(24), 'to', to.padEnd(24), 'please', pls.padEnd(24));
}
