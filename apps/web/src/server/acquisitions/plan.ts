export type ConversionState = {
  status: string;
  version: number;
  convertedBuildingId: string | null;
  conversionCommandId: string | null;
};

export type ConversionPlan =
  | { kind: "already_converted"; buildingId: string; commandId: string }
  | { kind: "convert"; createLoan: boolean };

/**
 * ACQ-01: the conversion creates the building and its links exactly once. The
 * opportunity's own `conversion_command_id` is the proof it already ran, so a
 * second call returns the first one's outcome and writes nothing.
 */
export function planConversion(
  opportunity: ConversionState,
  scenario: { loanAmount: string | null } | undefined,
): ConversionPlan {
  if (opportunity.conversionCommandId !== null && opportunity.convertedBuildingId !== null) {
    return {
      kind: "already_converted",
      buildingId: opportunity.convertedBuildingId,
      commandId: opportunity.conversionCommandId,
    };
  }
  const loanAmount = scenario?.loanAmount ?? null;
  return { kind: "convert", createLoan: loanAmount !== null && Number(loanAmount) > 0 };
}
