import { eq } from "drizzle-orm";
import type { DbHandle, Tx } from "./client";
import {
  activity,
  appUser,
  assetComponent,
  bankAccount,
  building,
  ccaMovement,
  contactPoint,
  deadline,
  depositAccount,
  depositMovement,
  document,
  documentVersion,
  equipment,
  equipmentAssignment,
  event,
  expense,
  expenseAllocation,
  expenseLine,
  fixedAsset,
  inboxItem,
  lease,
  leaseParty,
  leaseUnit,
  leaseVersion,
  legalEntity,
  loan,
  loanInstallment,
  loanScheduleVersion,
  membership,
  meter,
  meterReading,
  meterServicePeriod,
  organization,
  partnerCurrentAccount,
  payment,
  paymentAllocation,
  person,
  personRole,
  rentTerm,
  rentTermVersion,
  supplier,
  unit,
  unitUsagePeriod,
} from "./generated/schema";
import { ensureObjectRef, linkActivity, linkDeadline, linkEvent } from "./object-ref";
import { withoutTenant, withTenant } from "./tenant";

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

export const SEED_IDS = {
  organization: id(1),
  user: id(2),
  membership: id(3),
  legalEntity: id(4),
  bankAccount: id(5),
  buildingLilas: id(10),
  buildingPort: id(11),
  supplier: id(20),
  personCamille: id(30),
  personAlex: id(31),
  personSacha: id(32),
  leaseLilas: id(40),
  leasePort: id(41),
  depositLilas: id(50),
  paymentFull: id(60),
  paymentPartial: id(61),
  loan: id(70),
  cca: id(80),
  fixedAsset: id(90),
  equipment: id(100),
  meter: id(110),
  expense: id(120),
  document: id(130),
  activity: id(140),
  event: id(141),
  deadline: id(142),
  inboxItem: id(143),
} as const;

const unitId = (building: "lilas" | "port", index: number) =>
  id((building === "lilas" ? 200 : 300) + index);

function isoDate(value: Date): string {
  const text = value.toISOString();
  return text.slice(0, 10);
}

function monthWindow(offset: number) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0));
  return { start: isoDate(start), end: isoDate(end), due: isoDate(start) };
}

export type SeedResult = { organizationId: string };

export async function seed(handle: DbHandle): Promise<SeedResult> {
  await withoutTenant(handle, async (tx) => {
    await tx
      .insert(organization)
      .values({
        id: SEED_IDS.organization,
        code: "demo",
        name: "Organisation de démonstration",
        displayTimezone: "Europe/Paris",
      })
      .onConflictDoNothing();
    await tx
      .insert(appUser)
      .values({
        id: SEED_IDS.user,
        email: "proprietaire@exemple.test",
        fullName: "Camille Martin",
      })
      .onConflictDoNothing();
    await tx
      .insert(membership)
      .values({
        id: SEED_IDS.membership,
        organizationId: SEED_IDS.organization,
        appUserId: SEED_IDS.user,
        role: "owner_admin",
      })
      .onConflictDoNothing();
  });

  await withTenant(handle, { organizationId: SEED_IDS.organization }, seedTenantData);
  return { organizationId: SEED_IDS.organization };
}

async function seedTenantData(tx: Tx): Promise<void> {
  const organizationId = SEED_IDS.organization;
  const current = monthWindow(0);
  const previous = monthWindow(-1);

  await tx
    .insert(legalEntity)
    .values({
      id: SEED_IDS.legalEntity,
      organizationId,
      name: "SCI Exemple",
      legalForm: "sci",
      incomeTaxRegime: "is",
      vatStatus: "to_qualify",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      status: "active",
    })
    .onConflictDoNothing();

  await tx
    .insert(bankAccount)
    .values({
      id: SEED_IDS.bankAccount,
      organizationId,
      legalEntityId: SEED_IDS.legalEntity,
      label: "Compte courant SCI",
      bankName: "Banque de démonstration",
      ibanLast4: "0000",
      purpose: "operating",
      openingBalance: "12500.00",
      openingBalanceOn: "2026-01-01",
    })
    .onConflictDoNothing();

  await tx
    .insert(building)
    .values([
      {
        id: SEED_IDS.buildingLilas,
        organizationId,
        legalEntityId: SEED_IDS.legalEntity,
        code: "LIL",
        name: "Résidence des Lilas",
        addressLine1: "12 rue des Lilas",
        postalCode: "64000",
        city: "Pau",
        acquiredOn: "2019-06-15",
      },
      {
        id: SEED_IDS.buildingPort,
        organizationId,
        legalEntityId: SEED_IDS.legalEntity,
        code: "PRT",
        name: "Immeuble du Port",
        addressLine1: "4 quai du Port",
        postalCode: "64200",
        city: "Biarritz",
        acquiredOn: "2022-03-01",
      },
    ])
    .onConflictDoNothing();

  const lilasUnits = [1, 2, 3, 4, 5, 6].map((n) => ({
    id: unitId("lilas", n),
    organizationId,
    buildingId: SEED_IDS.buildingLilas,
    code: `LIL-${n.toString().padStart(2, "0")}`,
    label: n <= 4 ? `Appartement ${n}` : n === 5 ? "Parking 1" : "Cave 1",
    kind: n <= 4 ? ("dwelling" as const) : n === 5 ? ("parking" as const) : ("storage" as const),
    roomCount: n <= 4 ? 2 + (n % 2) : null,
    livingAreaSqm: n <= 4 ? `${40 + n * 5}.00` : null,
    energyClass: n <= 4 ? ("D" as const) : null,
  }));
  const portUnits = [1, 2, 3, 4].map((n) => ({
    id: unitId("port", n),
    organizationId,
    buildingId: SEED_IDS.buildingPort,
    code: `PRT-${n.toString().padStart(2, "0")}`,
    label: n === 4 ? "Studio meublé tourisme" : `Appartement ${n}`,
    kind: "dwelling" as const,
    roomCount: n === 4 ? 1 : 3,
    livingAreaSqm: n === 4 ? "24.00" : "62.00",
    energyClass: "C" as const,
  }));
  await tx
    .insert(unit)
    .values([...lilasUnits, ...portUnits])
    .onConflictDoNothing();

  await tx
    .insert(unitUsagePeriod)
    .values([
      {
        id: id(400),
        organizationId,
        unitId: unitId("lilas", 1),
        usage: "bare_rental",
        startsOn: "2023-01-01",
      },
      {
        id: id(401),
        organizationId,
        unitId: unitId("port", 1),
        usage: "furnished_rental",
        startsOn: "2023-09-01",
      },
      {
        id: id(402),
        organizationId,
        unitId: unitId("port", 4),
        usage: "tourist_rental",
        startsOn: "2024-04-01",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(person)
    .values([
      {
        id: SEED_IDS.personCamille,
        organizationId,
        displayName: "Camille Martin",
        firstName: "Camille",
        lastName: "Martin",
      },
      {
        id: SEED_IDS.personAlex,
        organizationId,
        displayName: "Alex Durand",
        firstName: "Alex",
        lastName: "Durand",
      },
      {
        id: SEED_IDS.personSacha,
        organizationId,
        displayName: "Sacha Lefèvre",
        firstName: "Sacha",
        lastName: "Lefèvre",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(contactPoint)
    .values([
      {
        id: id(410),
        organizationId,
        personId: SEED_IDS.personAlex,
        kind: "email",
        value: "alex.durand@exemple.test",
        isPrimary: true,
      },
      {
        id: id(411),
        organizationId,
        personId: SEED_IDS.personSacha,
        kind: "mobile",
        value: "+33600000000",
        isPrimary: true,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(personRole)
    .values([
      {
        id: id(420),
        organizationId,
        personId: SEED_IDS.personAlex,
        role: "tenant",
        startsOn: "2023-01-01",
      },
      {
        id: id(421),
        organizationId,
        personId: SEED_IDS.personSacha,
        role: "tenant",
        startsOn: "2023-09-01",
      },
      {
        id: id(422),
        organizationId,
        personId: SEED_IDS.personCamille,
        role: "partner",
        legalEntityId: SEED_IDS.legalEntity,
        startsOn: "2019-01-01",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(lease)
    .values([
      {
        id: SEED_IDS.leaseLilas,
        organizationId,
        legalEntityId: SEED_IDS.legalEntity,
        reference: "BAIL-LIL-01",
        kind: "bare",
        status: "active",
        signedOn: "2022-12-20",
        startsOn: "2023-01-01",
        durationMonths: 36,
        rentExclCharges: "620.00",
        chargeRegime: "provision",
        chargeAmount: "60.00",
        depositAmount: "620.00",
        paymentDay: 5,
        revisionIndex: "irl",
        revisionMonth: 1,
      },
      {
        id: SEED_IDS.leasePort,
        organizationId,
        legalEntityId: SEED_IDS.legalEntity,
        reference: "BAIL-PRT-01",
        kind: "furnished",
        status: "active",
        signedOn: "2023-08-25",
        startsOn: "2023-09-01",
        durationMonths: 12,
        rentExclCharges: "780.00",
        chargeRegime: "flat_fee",
        chargeAmount: "45.00",
        depositAmount: "1560.00",
        paymentDay: 1,
        revisionIndex: "irl",
        revisionMonth: 9,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(leaseVersion)
    .values([
      {
        id: id(430),
        organizationId,
        leaseId: SEED_IDS.leaseLilas,
        sequence: 1,
        kind: "initial",
        effectiveOn: "2023-01-01",
        signedOn: "2022-12-20",
        rentExclCharges: "620.00",
        chargeAmount: "60.00",
      },
      {
        id: id(431),
        organizationId,
        leaseId: SEED_IDS.leasePort,
        sequence: 1,
        kind: "initial",
        effectiveOn: "2023-09-01",
        signedOn: "2023-08-25",
        rentExclCharges: "780.00",
        chargeAmount: "45.00",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(leaseParty)
    .values([
      {
        id: id(440),
        organizationId,
        leaseId: SEED_IDS.leaseLilas,
        personId: SEED_IDS.personAlex,
        role: "holder",
        startsOn: "2023-01-01",
        isBillingContact: true,
      },
      {
        id: id(441),
        organizationId,
        leaseId: SEED_IDS.leasePort,
        personId: SEED_IDS.personSacha,
        role: "holder",
        startsOn: "2023-09-01",
        isBillingContact: true,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(leaseUnit)
    .values([
      {
        id: id(450),
        organizationId,
        leaseId: SEED_IDS.leaseLilas,
        unitId: unitId("lilas", 1),
        role: "main",
        startsOn: "2023-01-01",
      },
      {
        id: id(451),
        organizationId,
        leaseId: SEED_IDS.leasePort,
        unitId: unitId("port", 1),
        role: "main",
        startsOn: "2023-09-01",
      },
    ])
    .onConflictDoNothing();

  const terms = [
    {
      termId: id(460),
      versionId: id(465),
      leaseId: SEED_IDS.leaseLilas,
      window: previous,
      rent: "620.00",
      charge: "60.00",
      total: "680.00",
      status: "settled" as const,
    },
    {
      termId: id(461),
      versionId: id(466),
      leaseId: SEED_IDS.leaseLilas,
      window: current,
      rent: "620.00",
      charge: "60.00",
      total: "680.00",
      status: "partially_settled" as const,
    },
    {
      termId: id(462),
      versionId: id(467),
      leaseId: SEED_IDS.leasePort,
      window: previous,
      rent: "780.00",
      charge: "45.00",
      total: "825.00",
      status: "settled" as const,
    },
    {
      termId: id(463),
      versionId: id(468),
      leaseId: SEED_IDS.leasePort,
      window: current,
      rent: "780.00",
      charge: "45.00",
      total: "825.00",
      status: "posted" as const,
    },
  ];

  await tx
    .insert(rentTerm)
    .values(
      terms.map((t) => ({
        id: t.termId,
        organizationId,
        leaseId: t.leaseId,
        kind: "rent" as const,
        periodStart: t.window.start,
        periodEnd: t.window.end,
        dueOn: t.window.due,
        status: t.status,
        postedAt: new Date().toISOString(),
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(rentTermVersion)
    .values(
      terms.map((t) => ({
        id: t.versionId,
        organizationId,
        rentTermId: t.termId,
        sequence: 1,
        rentAmount: t.rent,
        chargeAmount: t.charge,
        accessoryAmount: "0.00",
        totalAmount: t.total,
        reason: "initial" as const,
        isPosted: true,
      })),
    )
    .onConflictDoNothing();

  for (const t of terms) {
    await tx
      .update(rentTerm)
      .set({ currentVersionId: t.versionId })
      .where(eq(rentTerm.id, t.termId));
  }

  await tx
    .insert(payment)
    .values([
      {
        id: SEED_IDS.paymentFull,
        organizationId,
        legalEntityId: SEED_IDS.legalEntity,
        direction: "inbound",
        amount: "680.00",
        receivedOn: previous.due,
        method: "transfer",
        payerPersonId: SEED_IDS.personAlex,
        status: "allocated",
      },
      {
        id: SEED_IDS.paymentPartial,
        organizationId,
        legalEntityId: SEED_IDS.legalEntity,
        direction: "inbound",
        amount: "400.00",
        receivedOn: current.due,
        method: "transfer",
        payerPersonId: SEED_IDS.personAlex,
        status: "partially_allocated",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(paymentAllocation)
    .values([
      {
        id: id(470),
        organizationId,
        paymentId: SEED_IDS.paymentFull,
        rentTermId: id(460),
        amount: "680.00",
        allocatedOn: previous.due,
        confirmedByOdoo: false,
      },
      {
        id: id(471),
        organizationId,
        paymentId: SEED_IDS.paymentPartial,
        rentTermId: id(461),
        amount: "400.00",
        allocatedOn: current.due,
        confirmedByOdoo: false,
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(depositAccount)
    .values({
      id: SEED_IDS.depositLilas,
      organizationId,
      leaseId: SEED_IDS.leaseLilas,
      contractualAmount: "620.00",
      status: "open",
    })
    .onConflictDoNothing();

  await tx
    .insert(depositMovement)
    .values({
      id: id(480),
      organizationId,
      depositAccountId: SEED_IDS.depositLilas,
      kind: "received",
      amount: "620.00",
      occurredOn: "2023-01-03",
    })
    .onConflictDoNothing();

  await tx
    .insert(loan)
    .values({
      id: SEED_IDS.loan,
      organizationId,
      legalEntityId: SEED_IDS.legalEntity,
      lenderName: "Banque de démonstration",
      reference: "PRET-2019-01",
      principalAmount: "180000.00",
      releasedOn: "2019-06-20",
      durationMonths: 240,
      rateKind: "fixed",
      nominalRate: "0.014000",
      insuranceRate: "0.003000",
      bankAccountId: SEED_IDS.bankAccount,
    })
    .onConflictDoNothing();

  await tx
    .insert(loanScheduleVersion)
    .values({
      id: id(490),
      organizationId,
      loanId: SEED_IDS.loan,
      sequence: 1,
      reason: "initial",
      effectiveFrom: "2019-07-01",
      source: "lender_document",
    })
    .onConflictDoNothing();

  await tx
    .insert(loanInstallment)
    .values(
      [1, 2, 3].map((n) => ({
        id: id(490 + n),
        organizationId,
        scheduleVersionId: id(490),
        installmentNumber: n,
        dueOn: `2019-${(6 + n).toString().padStart(2, "0")}-01`,
        principalAmount: "650.00",
        interestAmount: "210.00",
        insuranceAmount: "45.00",
        feesAmount: "0.00",
        totalAmount: "905.00",
        remainingPrincipal: `${180000 - 650 * n}.00`,
        status: "matched" as const,
      })),
    )
    .onConflictDoNothing();

  await tx
    .insert(partnerCurrentAccount)
    .values({
      id: SEED_IDS.cca,
      organizationId,
      legalEntityId: SEED_IDS.legalEntity,
      partnerPersonId: SEED_IDS.personCamille,
      interestRate: "0.000000",
      currency: "EUR",
    })
    .onConflictDoNothing();

  await tx
    .insert(ccaMovement)
    .values([
      {
        id: id(500),
        organizationId,
        ccaId: SEED_IDS.cca,
        kind: "contribution",
        amount: "15000.00",
        occurredOn: "2019-06-10",
        status: "posted",
      },
      {
        id: id(501),
        organizationId,
        ccaId: SEED_IDS.cca,
        kind: "expense_paid_personally",
        amount: "480.00",
        occurredOn: "2024-11-12",
        status: "validated",
      },
      {
        id: id(502),
        organizationId,
        ccaId: SEED_IDS.cca,
        kind: "repayment",
        amount: "-2000.00",
        occurredOn: "2025-04-03",
        status: "posted",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(fixedAsset)
    .values({
      id: SEED_IDS.fixedAsset,
      organizationId,
      legalEntityId: SEED_IDS.legalEntity,
      buildingId: SEED_IDS.buildingLilas,
      label: "Résidence des Lilas — immeuble",
      grossValue: "240000.00",
      landValue: "48000.00",
      commissionedOn: "2019-06-15",
      durationYears: "30.000000",
      method: "components",
      status: "running",
    })
    .onConflictDoNothing();

  await tx
    .insert(assetComponent)
    .values([
      {
        id: id(510),
        organizationId,
        fixedAssetId: SEED_IDS.fixedAsset,
        label: "Toiture",
        grossValue: "36000.00",
        durationYears: "25.000000",
        commissionedOn: "2019-06-15",
      },
      {
        id: id(511),
        organizationId,
        fixedAssetId: SEED_IDS.fixedAsset,
        label: "Installations techniques",
        grossValue: "24000.00",
        durationYears: "15.000000",
        commissionedOn: "2019-06-15",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(supplier)
    .values({
      id: SEED_IDS.supplier,
      organizationId,
      name: "Entreprise Démo Plomberie",
      trade: "plomberie",
      status: "active",
    })
    .onConflictDoNothing();

  await tx
    .insert(equipment)
    .values({
      id: SEED_IDS.equipment,
      organizationId,
      category: "chauffage",
      label: "Chaudière gaz collective",
      brand: "DemoTherm",
      supplierId: SEED_IDS.supplier,
      fixedAssetId: SEED_IDS.fixedAsset,
      purchasedOn: "2021-09-01",
      commissionedOn: "2021-09-15",
      documentedCost: "8200.00",
    })
    .onConflictDoNothing();

  await tx
    .insert(equipmentAssignment)
    .values({
      id: id(520),
      organizationId,
      equipmentId: SEED_IDS.equipment,
      buildingId: SEED_IDS.buildingLilas,
      startsOn: "2021-09-15",
      locationNote: "Local technique sous-sol",
    })
    .onConflictDoNothing();

  await tx
    .insert(meter)
    .values({
      id: SEED_IDS.meter,
      organizationId,
      buildingId: SEED_IDS.buildingLilas,
      fluid: "water_cold",
      scope: "individual",
      unitOfMeasure: "m3",
      serialNumber: "DEMO-WM-001",
      installedOn: "2021-09-15",
    })
    .onConflictDoNothing();

  await tx
    .insert(meterServicePeriod)
    .values({
      id: id(530),
      organizationId,
      meterId: SEED_IDS.meter,
      unitId: unitId("lilas", 1),
      share: "1.000000",
      startsOn: "2021-09-15",
    })
    .onConflictDoNothing();

  await tx
    .insert(meterReading)
    .values([
      {
        id: id(531),
        organizationId,
        meterId: SEED_IDS.meter,
        indexValue: "128.4000",
        readOn: previous.start,
        origin: "owner",
        status: "validated",
      },
      {
        id: id(532),
        organizationId,
        meterId: SEED_IDS.meter,
        indexValue: "134.9000",
        readOn: current.start,
        origin: "owner",
        status: "validated",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(expense)
    .values({
      id: SEED_IDS.expense,
      organizationId,
      legalEntityId: SEED_IDS.legalEntity,
      supplierId: SEED_IDS.supplier,
      documentKind: "invoice",
      supplierReference: "FA-2026-0042",
      issuedOn: previous.end,
      totalExclTax: "500.00",
      taxAmount: "100.00",
      totalInclTax: "600.00",
      payer: "entity",
      status: "validated",
    })
    .onConflictDoNothing();

  await tx
    .insert(expenseLine)
    .values({
      id: id(540),
      organizationId,
      expenseId: SEED_IDS.expense,
      lineNumber: 1,
      description: "Entretien annuel chaudière collective",
      amountExclTax: "500.00",
      taxAmount: "100.00",
      amountInclTax: "600.00",
      recoverableShare: "1.000000",
      servicePeriodStart: previous.start,
      servicePeriodEnd: previous.end,
      unallocatedAmount: "0.00",
    })
    .onConflictDoNothing();

  await tx
    .insert(expenseAllocation)
    .values([
      {
        id: id(541),
        organizationId,
        expenseLineId: id(540),
        target: "unit",
        unitId: unitId("lilas", 1),
        amount: "150.00",
        recoverableAmount: "150.00",
      },
      {
        id: id(542),
        organizationId,
        expenseLineId: id(540),
        target: "unit",
        unitId: unitId("lilas", 2),
        amount: "150.00",
        recoverableAmount: "150.00",
      },
      {
        id: id(543),
        organizationId,
        expenseLineId: id(540),
        target: "building_common",
        buildingId: SEED_IDS.buildingLilas,
        amount: "300.00",
        recoverableAmount: "300.00",
      },
    ])
    .onConflictDoNothing();

  await tx
    .insert(document)
    .values({
      id: SEED_IDS.document,
      organizationId,
      title: "Facture entretien chaudière FA-2026-0042",
      nature: "supplier_invoice",
      confidentiality: "internal",
      retentionClass: "accounting_10y",
    })
    .onConflictDoNothing();

  await tx
    .insert(documentVersion)
    .values({
      id: id(550),
      organizationId,
      documentId: SEED_IDS.document,
      sequence: 1,
      role: "original",
      storageKey: "demo/fa-2026-0042.pdf",
      contentType: "application/pdf",
      byteSize: 128_000,
      sha256: "0".repeat(64),
      virusScanStatus: "skipped",
    })
    .onConflictDoNothing();

  await tx
    .update(document)
    .set({ currentVersionId: id(550) })
    .where(eq(document.id, SEED_IDS.document));

  const leaseRef = await ensureObjectRef(tx, {
    organizationId,
    kind: "lease",
    id: SEED_IDS.leaseLilas,
  });
  const unitRef = await ensureObjectRef(tx, {
    organizationId,
    kind: "unit",
    id: unitId("lilas", 1),
  });
  const expenseRef = await ensureObjectRef(tx, {
    organizationId,
    kind: "expense",
    id: SEED_IDS.expense,
  });
  await ensureObjectRef(tx, { organizationId, kind: "person", id: SEED_IDS.personAlex });

  await tx
    .insert(activity)
    .values({
      id: SEED_IDS.activity,
      organizationId,
      channel: "email",
      direction: "inbound",
      subject: "Fuite sous l’évier",
      bodyRaw: "Bonjour, il y a une fuite sous l’évier de la cuisine.",
      authorPersonId: SEED_IDS.personAlex,
      occurredAt: `${previous.end}T09:15:00.000Z`,
    })
    .onConflictDoNothing();

  await tx
    .insert(event)
    .values({
      id: SEED_IDS.event,
      organizationId,
      type: "expense.validated",
      primaryObjectRefId: expenseRef,
      occurredAt: `${previous.end}T17:00:00.000Z`,
      origin: "user",
      actorUserId: SEED_IDS.user,
      payload: { supplierReference: "FA-2026-0042" },
    })
    .onConflictDoNothing();

  await tx
    .insert(deadline)
    .values({
      id: SEED_IDS.deadline,
      organizationId,
      type: "boiler.maintenance",
      title: "Entretien annuel de la chaudière",
      dueOn: current.end,
      priority: "normal",
      recurrenceAnchor: "execution_date",
      status: "planned",
    })
    .onConflictDoNothing();

  await linkActivity(tx, {
    organizationId,
    activityId: SEED_IDS.activity,
    objectRefId: leaseRef,
    relation: "about",
  });
  await linkEvent(tx, {
    organizationId,
    eventId: SEED_IDS.event,
    objectRefId: expenseRef,
    relation: "primary",
  });
  await linkDeadline(tx, {
    organizationId,
    deadlineId: SEED_IDS.deadline,
    objectRefId: unitRef,
    relation: "about",
  });

  await tx
    .insert(inboxItem)
    .values({
      id: SEED_IDS.inboxItem,
      organizationId,
      activityId: SEED_IDS.activity,
      source: "email_forward",
      sourceReference: "demo-email-0001",
      proposedObjectRefId: leaseRef,
      proposedAction: "create_intervention",
      uncertaintyReason: "Le lot concerné n’est pas nommé dans le message.",
      status: "analyzed",
    })
    .onConflictDoNothing();
}
