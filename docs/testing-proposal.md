# Proposta de organização dos testes

Levantamento feito em 2026-09-24 sobre a v2.0.0, rodando cada suíte contra Redis 7 e
PostgreSQL 17 locais. Os tempos são wall clock de uma execução, incluindo a compilação do ts-jest.

## 1. Inventário atual

| Pacote | Arquivos | Casos | Tempo | Infra | Observação |
|---|---|---|---|---|---|
| `api` (default + v5 + v6) | 48 | 402 | 30 s | Redis, Postgres opcional | 311 casos em `tests/api/`, 77 na matriz BullMQ |
| `api` (floor 5.56.0) | 40 | 325 | 28 s | Redis | reexecuta **todo** o projeto default |
| `metrics` | 24 | 249 | 33 s | Redis (1 DB por worker), Postgres | 71 casos em `tests/postgres/` |
| `ui` | 56 | 389 | 23 s | nenhuma (jsdom) | já separado em components/hooks/pages/utils |
| `cli` | 12 | 157 | 40 s | Redis, Postgres, OIDC fake | a suíte mais lenta |
| `auth` | 2 | 37 | 7 s | OIDC fake em processo | |
| `nestjs` (11 + 12) | 8 × 2 | 47 + 8 todo, × 2 | 17 s + 14 s | Redis, Postgres | reorganizado nesta rodada |
| `express` (v4 + v5) | 1 × 2 | 24 | 6 s | Redis | só a bateria de contrato |
| `fastify`, `hono`, `koa`, `hapi`, `elysia` | 1 cada | 12 cada | 3–5 s | Redis | só a bateria de contrato |
| `h3` (v1 + v2) | 1 × 2 | 24 | 7 s | Redis | só a bateria de contrato |
| `bun` | 1 | 12 | 2 s | Redis, runtime Bun | só a bateria de contrato |

Total aproximado: ~1.800 execuções de caso, ~4 min em sequência.

### Duplicações encontradas

1. **Bateria de contrato de 12 casos**, repetida em 13 execuções (express ×2, h3 ×2, nestjs ×2,
   fastify, hono, koa, hapi, elysia, bun): 156 casos. É duplicação intencional, porque cada
   adaptador tem roteamento próprio. Mas os casos 6–8 (job schedulers) e 11 testam regras do
   `api`, não do adaptador: o que o adaptador precisa provar é rota com params, corpo parseado,
   PATCH, assets, HTML de entrada e basePath.
2. **Projeto floor do `api`** reexecuta os 325 casos do default contra BullMQ 5.56.0. Os
   bloqueadores documentados do piso (`every` como string, `upsertJobScheduler`,
   `removeGlobalConcurrency`) devem se concentrar em ~5 arquivos (a confirmar rodando o floor arquivo a arquivo) (`job-schedulers`, `scheduled-job-removal`,
   `global-concurrency`, `queues`, `bullMQ`).
3. **Postgres em três lugares**: `api/tests/bullmq-matrix/postgres.spec.ts` (adaptador, stats,
   fluxos), `metrics/tests/bullmq-matrix/postgres*.spec.ts` (recorder sobre fila Postgres) e
   `cli/tests/postgres.spec.ts` (descoberta de filas + `--history`). Os três sobem fila BullMQ v6
   em Postgres e verificam listagem/stats; a sobreposição real é "fila Postgres aparece com
   contagens", repetida nos três, além do cenário `nestjs/tests/scenarios/postgres.spec.ts`.
4. **Paridade Redis × Postgres no `metrics`**: `tests/postgres/*Store.spec.ts` espelham os
   `HistoryStore`/`LatencyStore`/`HistoryAdmin` de Redis caso a caso (~70 casos). Candidato a
   uma bateria parametrizada por store, no estilo do contrato de adaptadores.
5. **Autenticação**: `cli/tests/auth.spec.ts` (8 casos de Basic) retesta
   `@worker-manager/auth`, que o CLI apenas embrulha; `auth/tests/basic.spec.ts` já cobre
   comparação em tempo constante e o desafio `WWW-Authenticate`. O provedor OIDC fake está
   copiado em `auth/tests`, `cli/tests/keycloak.spec.ts` e `nestjs/tests/support`.
6. **Filas com mesmo nome e prefixo diferente**: testado no `api`
   (`same-name-different-prefix`) e no `nestjs` (`module/queue-registration`). No `nestjs` o
   que importa é a resolução por instância em `forFeature`, então os dois se justificam, mas o
   do `api` pode virar unitário do adaptador.

## 2. Layout proposto por pacote

Regra geral: `unit/` não precisa de infra, `integration/` precisa de Redis e/ou Postgres,
`contract/` roda uma bateria compartilhada, `matrix/` roda contra versões aliasadas, e
`scenarios/` (só em pacotes de integração com framework) sobe a aplicação como o usuário faria.

```
api/tests/        unit/ (schemas, openapi, errors, hooks, request/response validation)
                  integration/ (handlers por rota, adapters bull/bullmq/pro)
                  matrix/ (atual bullmq-matrix: v5, v6, postgres)
                  floor/ (subconjunto que prova o piso 5.56.0)
metrics/tests/    unit/ (keys, histogram, dataMapping, protocolGuardrail, storeDefaults)
                  contract/ (bateria de store rodada contra Redis e Postgres)
                  integration/ (recorder, e2e, cluster)
                  matrix/
cli/tests/        unit/ (config, config-file, describeError, registry, connectionState)
                  integration/ (server, discovery, connection, postgres, keycloak)
auth/tests/       unit/ (basic) + integration/ (keycloak com OIDC fake)
ui/tests/         mantém components/hooks/pages/utils/services
nestjs/tests/     scenarios/ module/ contract/ support/   (feito)
<adaptador>/tests contract/ (+ specs próprios do adaptador, se houver)
test-utils/src    contract, fixtures Redis, fixture da UI, **OIDC fake** e **fila Postgres**
```

Com `unit/` separado, cada pacote ganha um `test:unit` sem Docker, útil em pre-commit.

## 3. Essenciais × candidatos a remover ou fundir

| Onde | Essencial | Candidato | Ação sugerida | Casos a menos |
|---|---|---|---|---|
| contrato de adaptadores | rotas, params, corpo, PATCH, assets, HTML, basePath | casos 6–8 e 11 (schedulers) | manter só 1 caso de scheduler (PATCH com corpo) | ~39 |
| `api` floor | specs que dependem do piso | os outros ~35 arquivos | `testMatch` restrito | ~280 execuções |
| `metrics` stores | uma bateria por contrato de store | cópias Redis/Postgres | bateria parametrizada | ~30 |
| `cli/tests/auth.spec.ts` | 1 caso: CLI aplica Basic | 7 casos de borda do Basic | apagar, já cobertos em `auth` | 7 |
| `cli` keycloak e2e | 401 / 302 / 200 / 403 | builders de opções já cobertos | manter; mover OIDC fake para `test-utils` | 0 |
| Postgres "fila aparece" | 1 por pacote consumidor | repetições em `api`/`metrics`/`cli` | manter a do `api` como fonte de verdade, reduzir as outras ao que é do pacote | ~6 |
| `api/tests/api/*` | handlers com regra própria | specs de 1 caso que só checam 200 | fundir em `integration/routes.spec.ts` | ~10 |
| `ui` | utils e hooks | snapshots/renders triviais de componentes | revisar por baixa cobertura de comportamento | a medir |

Estimativa: ~370 execuções de caso a menos (~20%) e ~35 s a menos no pipeline, sem perder um
comportamento que não esteja coberto em outro lugar.

## 4. Ordem sugerida

1. **`test-utils`**: trazer o OIDC fake e um `seedPostgresQueue()` para o kit (desbloqueia o
   resto e remove as três cópias do provedor). Exige resolver o `__dirname` do barrel para o
   projeto ESM, hoje contornado por `esm-test-utils.ts`.
2. **`api` floor**: restringir o `testMatch`. Maior ganho de tempo com menor risco.
3. **Contrato de adaptadores**: enxugar para ~9 casos; mexe em 13 execuções de uma vez.
4. **`cli`**: separar `unit/` × `integration/`, apagar `auth.spec.ts`, usar o OIDC compartilhado.
5. **`metrics`**: bateria de store parametrizada Redis/Postgres.
6. **`api/tests/api`**: separar `unit/` e `integration/`, fundir specs triviais.
7. **`ui`**: só revisão de valor dos testes de componente; o layout já está bom.
8. **pg-boss**: quando o engine existir, implementar os `it.todo` de
   `nestjs/tests/scenarios/pg-boss.spec.ts` e criar o `matrix/pg-boss` no `api`.
