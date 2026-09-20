export type CamtEntry = {
  amount: number;
  date: string;
  remittance: string;
  endToEndId: string;
  partyName: string;
  partyIban?: string;
};

function entryXml(entry: CamtEntry): string {
  const credit = entry.amount >= 0;
  const party = credit ? "Dbtr" : "Cdtr";
  const amount = Math.abs(entry.amount).toFixed(2);
  return `      <Ntry>
        <Amt Ccy="EUR">${amount}</Amt>
        <CdtDbtInd>${credit ? "CRDT" : "DBIT"}</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>${entry.date}</Dt></BookgDt>
        <ValDt><Dt>${entry.date}</Dt></ValDt>
        <BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>RCDT</Cd><SubFmlyCd>ESCT</SubFmlyCd></Fmly></Domn></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs>
              <EndToEndId>${entry.endToEndId}</EndToEndId>
              <AcctSvcrRef>${entry.endToEndId}</AcctSvcrRef>
            </Refs>
            <RltdPties>
              <${party}><Nm>${entry.partyName}</Nm></${party}>
              ${entry.partyIban ? `<${party}Acct><Id><IBAN>${entry.partyIban}</IBAN></Id></${party}Acct>` : ""}
            </RltdPties>
            <RmtInf><Ustrd>${entry.remittance}</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
      </Ntry>`;
}

/** camt.053.001.02, the shape the OCA parser walks (GrpHdr then one Stmt per account). */
export function buildCamt053(input: {
  messageId: string;
  statementId: string;
  iban: string;
  date: string;
  balanceStart: number;
  entries: CamtEntry[];
}): string {
  const balanceEnd =
    input.balanceStart + input.entries.reduce((total, entry) => total + entry.amount, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>${input.messageId}</MsgId>
      <CreDtTm>${input.date}T08:00:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>${input.statementId}</Id>
      <CreDtTm>${input.date}T08:00:00</CreDtTm>
      <Acct>
        <Id><IBAN>${input.iban}</IBAN></Id>
        <Ccy>EUR</Ccy>
      </Acct>
      <Bal>
        <Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">${input.balanceStart.toFixed(2)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>${input.date}</Dt></Dt>
      </Bal>
      <Bal>
        <Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp>
        <Amt Ccy="EUR">${balanceEnd.toFixed(2)}</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Dt><Dt>${input.date}</Dt></Dt>
      </Bal>
${input.entries.map(entryXml).join("\n")}
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
}
