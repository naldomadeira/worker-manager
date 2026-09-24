# Avaliação do Kibo UI para Worker Manager

> **Nota de revisão (2026-09-24):** análise apenas, nada foi instalado. Conferido contra o repositório:
> `packages/ui` **não** usa dnd-kit hoje, então Kanban, Gantt e List trazem essa dependência nova.
> O comando de instalação e os nomes dos componentes vêm do site do Kibo UI e devem ser
> reconfirmados na hora de adotar cada um. Qualquer arrastar-e-soltar de jobs precisa mapear
> só para transições que a API já oferece (retry de failed, promote de delayed, remove).


## 1. Resumo

Kibo UI é um registro customizado de componentes composáveis, acessíveis e extensíveis construído sobre shadcn/ui, React, TypeScript, Tailwind CSS e Radix UI. Fornece componentes de nível superior como Gantt, Kanban, calendários e editores de código—reduzindo boilerplate sem sacrificar flexibilidade. Instala-se via `npx kibo-ui add <componente>` ou `npx shadcn add` com URL do registry. Licença MIT, mantido pela comunidade no repositório github.com/shadcnblocks/kibo com 3.8K stars.

## 2. Componentes Disponíveis e Análise

| Componente | Link | Onde Usaríamos | Valor | Esforço | Observações |
|---|---|---|---|---|---|
| **Kanban** | `/components/kanban` | Aba de Status (latest/active/waiting/prioritized/completed/failed/delayed) — colunas por status com drag-drop de jobs | Alto | M | Powered by dndkit. Requer API para mover jobs (retry, promote, cancel). Performance com >5k jobs precisa virtualization |
| **Gantt** | `/components/gantt` | Timeline visual de job schedulers (próxima execução, duração estimada) e histórico de job executions | Alto | M | Resize/drag via dndkit, date-fns. Suporta hierarquia e múltiplos items por row. Compatível Tailwind v4/React 19 |
| **Table** | `/components/table` | Lista de jobs em tabelas (job schedulers, histórico de execuções, logs). Sorting de colunas | Alto | M | Built on TanStack Table, Lucide, Jotai. Sem virtualization/pagination nativa — adicionar via TanStack para listas >1k items |
| **Contribution Graph** | `/components/contribution-graph` | Dashboard Overview — heatmap de throughput diário (jobs/dia) style GitHub | Alto | P | Customizável (block size, cores, tooltips). Ideal para KPI de produtividade em período anual |
| **Code Block** | `/components/code-block` | Abas Job Details: logs, error stack, data/options JSON. Syntax highlighting, copy, line numbers, diff | Alto | P | Syntax highlighting, line numbers, copy, file names, diff mode, tema claro/escuro. Já atende logging e error stacks |
| **Tree** | `/components/tree` | Sidebar queue tree (expand/collapse, multi-select). Animado, ícones customizáveis, navegação via teclado | Médio | M | Composable, suporta single/multi-select. Folder/file icons dinâmicas. Compatível React 19 e Tailwind v4 |
| **Relative Time** | `/components/relative-time` | Timestamps de jobs (created, started, completed). Suporta múltiplos timezones, auto-update a cada segundo | Médio | P | Múltiplos timezones com labels. Alternativa ao uso de date-fns diretamente. Controlled/uncontrolled state |
| **Status** | `/components/status` | Badges de status de job (online/offline/maintenance/degraded). Animação ping, customizável | Médio | P | Visual indicators com cores automáticas. Usado em service health — adaptável para job states (running, paused, failed) |
| **Pill** | `/components/pill` | Job status badges, tags. Suporta avatar, status states (success/error/warning/info), delta indicators | Médio | P | Flexível — avatar, icons, pulse animations. Perfeito para jobs filtering por tags/labels |
| **List** | `/components/list` | Alternativa ao Kanban — lista de jobs com drag-drop entre status, grouping por priority | Médio | M | Drag-drop via dndkit, grouping por status/priority. Menos visual que Kanban para task management |
| **Announcement** | `/components/announcement` | Notificações/alerts no top do dashboard (queue paused, error notification, maintenance). Badge-based | Baixo | P | Compound component (tag + title), themed (error/success/warning/info), hover effects |
| **Banner** | `/components/banner` | Full-width alerts (queue offline, job failure alert, maintenance notice). Dismissible com close handler | Baixo | P | Full-width, composed (Icon/Title/Action/Close), themed, controlled/uncontrolled state |
| **Mini Calendar** | `/components/mini-calendar` | Job scheduler date picker (próxima execução). Compact, 5 dias consecutive, customizável | Baixo | M | Horizontal layout, date-fns powered. Mais específico que Calendar — útil se scheduler dates são próximas |
| **Calendar** | `/components/calendar` | Grid calendar para scheduler features (show end date, group by day, status colors, date selection) | Médio | M | Grid-based, grouping, status color coding, pagination, localization. Alternativa a Gantt para view by calendar day |
| **Dropzone** | `/components/dropzone` | Import jobs JSON, bulk upload. Drag-drop files, preview, size validation, file type filter | Médio | P | react-dropzone, Lucide. Validação smart (tipo, tamanho, quantidade). Customizável appearance |
| **Tags** | `/components/tags` | Job filtering (tags, labels). Multi-select com search built-in, keyboard navigation | Médio | P | Search built-in, controlled/uncontrolled, remove functionality, keyboard complete |
| **Snippet** | `/components/snippet` | Alternativa leve a Code Block — display code em tabs (npm/yarn/pnpm/bun install). Copy functionality | Baixo | P | Tabbed interface, copy button, Radix Tabs. Mais simples que Code Block |
| **Ticker** | `/components/ticker` | Métrica em tempo real (jobs/min, throughput $, latency ms). Symbol + price + change % com cores | Baixo | P | Finance-oriented mas adaptável. ISO 4217 currency support. Não essencial |
| **Deck** | `/components/deck` | ❌ Não aplicável — Tinder-like swipeable cards. Sem use case em job queue dashboard | N/A | N/A | Swipe interactions, animations. Sem aplicação natural |
| **Cursor** | `/components/cursor` | ❌ Não aplicável — Realtime collaborative cursors. Sem multi-user editing no Worker Manager | N/A | N/A | Para collaborative apps. Worker Manager não é multi-user collaborative |
| **Credit Card** | `/components/credit-card` | ❌ Não aplicável — Finance forms. Worker Manager não processa pagamentos | N/A | N/A | Componente de finance, sem relevância |
| **Color Picker** | `/components/color-picker` | Settings dialog — customize brand colors, queue tags visual theme | Baixo | P | Customizable picker. Util se expandir customização visual |
| **Comparison** | `/components/comparison` | ❌ Marginal — Before/after comparação. Poderia comparer queue metrics (before/after deploy) | Baixo | P | Image comparison slider. Use case weak |
| **Dialog Stack** | `/components/dialog-stack` | Multi-level modals (Job details → edit flow → confirm delete). Stack management | Baixo | M | Gerencia stack de dialogs. Useful se flow modals ficarem complex |
| **Editor** | `/components/editor` | ❌ Marginal — Rich text editor. Não há campo text rich no Worker Manager | Baixo | M | Rich text via TipTap. Sem aplicação clara |
| **Glimpse** | `/components/glimpse` | ❌ Desconhecido — Pesquisar documentação adicional | ? | ? | Sem informação suficiente obtida |
| **Marquee** | `/components/marquee` | Status scrolling text (queue alerts, maintenance notifications). Scrolling animation | Baixo | P | Animated scroll text. Redundante vs Banner para alerts |
| **QR Code** | `/components/qr-code` | ❌ Marginal — QR code generator. Sem use case em job queue dashboard | Baixo | P | Sem aplicação |
| **Rating** | `/components/rating` | ❌ Não aplicável — Star ratings. Não há feedback rating no Worker Manager | N/A | N/A | Para user feedback/reviews |
| **Spinner** | `/components/spinner` | Loading states (queue loading, job processing). Já suportado por shadcn/ui | Baixo | P | Redundante — shadcn já tem Spinner |
| **Theme Switcher** | `/components/theme-switcher` | Settings dialog — light/dark mode toggle. Já é parte do sistema | Baixo | P | Redundante — tema já implementado |
| **Typography** | `/components/typography` | Text styling presets. Complementa Tailwind v4 | Baixo | P | Presets text — informativo |
| **Image Crop** | `/components/image-crop` | ❌ Não aplicável — Cropping de imagens. Worker Manager não tem upload de imagens | N/A | N/A | Sem use case |
| **Image Zoom** | `/components/image-zoom` | ❌ Marginal — Zoom de imagens. Poderia zoom em screenshots de jobs se uploaded | Baixo | P | Sem aplicação clara |
| **Combobox** | `/components/combobox` | Queue/job search filtering. Já suportado por shadcn/ui | Baixo | P | Redundante — shadcn tem Combobox |
| **Choicebox** | `/components/choicebox` | Radio/checkbox groups. Alternativa a shadcn Radio/Checkbox | Baixo | P | Styling variant de radio/checkbox |
| **Video Player** | `/components/video-player` | ❌ Não aplicável | N/A | N/A | Sem videos no dashboard |
| **Reel** | `/components/reel` | ❌ Não aplicável — Social media reel carousel | N/A | N/A | Sem use case |
| **Stories** | `/components/stories` | ❌ Não aplicável — Social stories carousel | N/A | N/A | Sem use case |

## 3. Top 5 Recomendados

### 1. **Kanban** (`npx kibo-ui add kanban`)

**Tela alvo:** Aba "Status" na Queue page — refatorar atual grid de job cards em colunas estilo Kanban (Latest, Active, Waiting, Waiting-Children, Prioritized, Completed, Failed, Delayed, Paused).

**Comportamento proposto:** Cada coluna é um job state. Cards (jobs) podem arrastar-drop entre status válidos (e.g., Failed → Retry, Active → Cancel). Ao soltar, dispara ação da API (`PUT /api/queues/:name/jobs/:id/retry` ou similar). Suporta virtualization para queues com milhares de jobs.

**O que substitui:** Atual UI mostra abas Text para cada status + grid de job cards. Kanban oferece uma visão unificada com drag-drop nativa—reduz clicks para retry/promote.

**Riscos:** 
- Não todo job state é drag-drop-able (e.g., "Completed" é terminal). Precisa validar transições válidas no Kanban.
- Performance: millares de jobs em uma coluna exigem virtualization—Kibo não promete isso OOB; pode ser adicionar `@xyflow/react` virtualization.
- UX: Kanban é familiar em Agile; pode confundir se usuários esperam semântica de "task priority" ao invés de "job state".

---

### 2. **Gantt** (`npx kibo-ui add gantt`)

**Tela alvo:** Job Schedulers page e nova aba Timeline em Job Details—visualizar próxima execução (cron/every), duração estimada, histórico de execuções.

**Comportamento proposto:** Cada scheduler/job é uma linha. Barra horizontal = período entre última e próxima execução. Cores por status (pending, completed, failed). Resize/drag para ajustar schedule (se edição permitida). Hover = tooltip com timestamps.

**O que substitui:** Atual Job Schedulers é tabela simples (cron, every, next run, actions). Gantt adiciona timeline visual—melhora detecção de padrões (e.g., "todas executam às 2am?"), hotspots de falha.

**Riscos:**
- Escalabilidade: Gantt com 10k+ schedulers é visualmente caótico. Precisa grouping/hierarchy (por queue, por tipo cron/every).
- Comportamento de resize/drag é delicado—só fazer se edição de schedule for needed.
- Dependências: dnd-kit (drag-drop, **nova no projeto**) e date-fns (já usado pela UI).

---

### 3. **Code Block** (`npx kibo-ui add code-block`)

**Tela alvo:** Job Details → abas Logs, Error, Data/Options. Também useful em Flow graph tooltips se mostrar job stack trace.

**Comportamento proposto:** Syntax highlighting automático (JSON para data, plaintext para logs, JavaScript/Python para stack traces). Line numbers, copy button, diff mode opcional. Tema segue app dark/light mode.

**O que substitui:** Atual UI mostra logs/data em `<pre>` tags com Tailwind styling. Code Block oferece syntax highlighting + copy nativa—reduz custom code, melhora UX.

**Riscos:**
- Nenhum risco material—é purely presentational. Compatível com React 19, Tailwind v4.
- Perf: syntax highlighting é lazy; Code Block usa Shiki que é rápido.

---

### 4. **Contribution Graph** (`npx kibo-ui add contribution-graph`)

**Tela alvo:** Dashboard Overview—adicionar KPI de throughput anual em heatmap style GitHub (jobs por dia, cores por volume).

**Comportamento proposto:** 365-day grid, cada célula = contagem de jobs completados aquele dia. Cor varia light→dark conforme volume. Hover = tooltip "N jobs completed on DD/MM/YYYY". Click = drilla down para aquele dia.

**O que substitui:** Atual Overview não tem throughput visual. Recharts bar/line chart mostra trends mas não padrão temporal. Contribution Graph é familiar (GitHub history) e compacto.

**Riscos:**
- Apenas historical data (passado). Não mostra forecast/expectations.
- Customização cores: Kibo default colors—confirmar se combina com brand colors.
- Perf: 365 cells é light; sem risco.

---

### 5. **Table com TanStack Virtualization** (`npx kibo-ui add table`)

**Tela alvo:** Job Schedulers page, Metrics History table, Job list em Queue page (como alternativa ao Kanban status view).

**Comportamento proposto:** Colunas sortáveis (click header para sort). Rows virtualizadas para grandes datasets (>1k). Adicionar TanStack VirtualTable wrapper se performance crítica.

**O que substitui:** Atual Tables são rodadas com shadcn/ui Table (primitivo). Kibo Table é built on TanStack Table = sorting, filtering, custom headers OOB.

**Riscos:**
- Virtualization não é built-in no Kibo—precisa wrapper. Exemplo: TanStack VirtualTable (`@tanstack/react-virtual`).
- TanStack Table aprendizado: Column defs são verbose, learning curve.

---

## 4. Não Recomendados

| Componente | Motivo |
|---|---|
| **Deck** | Swipeable card stack sem aplicação natural em job queue dashboard. UI metaphor mismatch. |
| **Cursor** | Para aplicações collaborative realtime. Worker Manager é single-user. |
| **Credit Card** | Finance form component—sem processamento de pagamento. |
| **Video Player**, **Reel**, **Stories** | Social media components. Sem relevância. |
| **Image Crop**, **Image Zoom** | Worker Manager não faz upload/exibe images. |
| **Rating** | Star ratings para user feedback. Sem aplicação. |
| **QR Code** | Sem use case identificado. |
| **Editor** | Rich text editor (TipTap-based). Não há campos rich-text no Worker Manager. |
| **Spinner**, **Theme Switcher**, **Combobox**, **Choicebox** | Redundantes com shadcn/ui já implementado. |
| **Comparison** | Image slider. Weak use case para queue metrics. |
| **Dialog Stack** | Marginal—útil só se modals ficarem deeply nested. Não é blocker. |
| **Marquee** | Scrolling text. Redundante com Banner para alerts. |
| **Mini Calendar** | Muito específico. Calendar (full grid) é mais flexível. |

## 5. Próximos Passos Sugeridos

1. **Prototipar Kanban com subset de status.** Criar branch, implementar `Kanban` em uma aba "Status View" experimentalmente. Validar UX com drag-drop entre 2-3 status (active → completed, failed → retry). Testar perf com 100-1000 jobs simulados.

2. **Validar TanStack Table integration.** Criarprototype de Job Schedulers table com TanStack Table + Kibo Table styling. Medir perf com 5k+ schedulers.

3. **Adicionar Contribution Graph ao Overview.** Request dados de throughput histórico (jobs/day last 365 days) do backend. Renderizar heatmap. Minimal effort, alto valor visual.

4. **Code Block para Logs/Error tabs.** Dropin replacement do `<pre>` atual. Validate color scheme em light/dark mode.

5. **Design: Kanban drag-drop constraints.** Documentar matriz de transições de job state—qual status → qual status é permitido. Implementar validação no UI (disable drag-drop para transições inválidas) e backend (reject se invalid).

6. **Viabilidade com Tailwind v4.** Confirmar Kibo components são fully compatible com Tailwind v4 (no breaking changes em CSS vars). Rodar `yarn build` post-install de novo componente.

7. **Monitorar radix-nova (shadcn Radix v2).** Kibo usa Radix primitivos. Quando shadcn upgrade para Radix v2, verificar compatibilidade Kibo. Atualmente sem issues sinalizados.

8. **Documentar instalação para team.** Padrão: `npx kibo-ui add <component>` auto-instala em `components/ui/<component>`. Versionar `package.json` diff em PR.

---

## Conclusão

Kibo UI é **altamente compatível** com Worker Manager. Top 5 componentes (Kanban, Gantt, Code Block, Contribution Graph, Table) trazem valor material:

- **Kanban**: drag-drop visual para job state transitions.
- **Gantt**: timeline visual para schedulers e job history.
- **Code Block**: syntax highlighting para logs/data/errors.
- **Contribution Graph**: throughput heatmap no dashboard.
- **Table**: job list with sorting/virtualization.

Instalaçãoé frictionless (`npx kibo-ui add`), composable API compatível com React 19 e Tailwind v4, e MIT licensed. Radix, shadcn, date-fns e recharts já estão no projeto; dnd-kit (Kanban, Gantt, List) seria uma dependência nova.

**Recomendação:** Começar com Contribution Graph (low-lift, high-value) e Kanban (prototypo experimental). Validar perf e UX antes de full rollout.
