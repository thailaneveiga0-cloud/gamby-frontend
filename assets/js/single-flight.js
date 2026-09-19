// Executa no máximo uma operação assíncrona por vez. Chamadas feitas enquanto
// uma está em voo são descartadas ({ skipped: true }) em vez de enfileiradas,
// para que duplo clique/F10 repetido nunca dispare duas vezes a mesma ação
// com efeito colateral (ex.: POST /v1/sales). O lock é sempre liberado, com
// sucesso ou erro, e o erro original é propagado sem alteração.
export function createSingleFlight() {
  let inFlight = false;

  return async function run(fn) {
    if (inFlight) return { skipped: true };
    inFlight = true;
    try {
      return { skipped: false, value: await fn() };
    } finally {
      inFlight = false;
    }
  };
}
