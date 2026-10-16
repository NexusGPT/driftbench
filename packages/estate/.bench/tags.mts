import nlp from 'compromise/two';
const ss = process.argv.slice(2).length ? process.argv.slice(2) : [
 'Users must sign in.','Customers must confirm the order.','The reviewer must confirm.','The assistant must confirm.','The agent must not leave.','The helper must log.','Maria must call.','Tests must pass.','Commits must end with a trailer.','The summary must include a link.','Suppliers should confirm the order.','The carrier must deliver by Friday.','Drivers must wear a vest.','The vendor requires an invoice.','You must confirm the manifest.','We should log it.','Claude must verify.','The model must answer.',
 'Confirm the manifest.','Keep replies short.','Use the staging key.','Answer in bullets.','Read the file before editing.','Do not write it.','Never skip them.','Replies stay under 80 words.','Responses are limited to 3 sentences.','Use of the key is common.','Bananas.','See references/guide.md.','Note that the build is slow.','Each depot sorts parcels by route.','Every courier carries a scanner.','Always.',
 'Verify that it works.','Make sure the label is attached.','Be concise.','Prefer short answers.','Avoid jargon.','Please confirm the order.','Remember to log the call.','Don\'t forget the checksum.','Ask before deleting.','Stop when the user says stop.'
];
for (const s of ss) {
  const d = nlp(s);
  const terms = (d.json()[0]?.terms ?? []) as any[];
  console.log(s.padEnd(48), terms.map((t) => `${t.text}:${t.tags.filter((x: string)=>!['Singular'].includes(x)).join('|')}`).join('  '));
}
