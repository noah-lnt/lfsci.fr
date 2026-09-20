import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { messages } from "../../i18n/messages";
import { ErrorBox } from "./error-box";

function render(requestId: string, message: string) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Europe/Paris">
      <ErrorBox error={{ code: "INTERNAL", message, requestId }} />
    </NextIntlClientProvider>,
  );
}

describe("<ErrorBox />", () => {
  const requestId = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

  it("shows the French message and the correlation reference", () => {
    const html = render(
      requestId,
      "Erreur interne ; la référence ci-dessous permet de la retrouver.",
    );
    expect(html).toContain("Erreur interne");
    expect(html).toContain("Référence");
    expect(html).toContain(requestId);
  });

  it("is announced to assistive technology", () => {
    expect(render(requestId, "Boum")).toContain('role="alert"');
  });

  it("offers a labelled copy control", () => {
    expect(render(requestId, "Boum")).toContain("Copier la référence");
  });
});
